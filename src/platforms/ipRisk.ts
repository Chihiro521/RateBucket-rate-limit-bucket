export type IpRiskProvider = "proxycheck";

export type IpRiskLabel = "正常" | "偏高" | "高" | "严重" | "未知";

export type IpRiskStatus = "disabled" | "missing-key" | "ok" | "error";

export type IpRiskSignals = {
  proxy: boolean;
  vpn: boolean;
  tor: boolean;
  hosting: boolean;
  type: string | null;
};

export type IpRiskState = {
  provider: IpRiskProvider;
  source: "proxycheck.io";
  status: IpRiskStatus;
  updatedAt: number;
  score: number | null;
  label: IpRiskLabel;
  signals: IpRiskSignals;
  errorMessage?: string;
};

export type IpRiskPublicSettings = {
  provider: IpRiskProvider;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
};

export type IpRiskStoredSettings = {
  provider: IpRiskProvider;
  enabled: boolean;
  proxycheckApiKey?: string;
};

export type IpRiskSettingsUpdate = {
  enabled: boolean;
  apiKey?: string;
  clearApiKey?: boolean;
};

export const IP_RISK_AUTO_REFRESH_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_IP_RISK_PUBLIC_SETTINGS: IpRiskPublicSettings = {
  provider: "proxycheck",
  enabled: false,
  hasApiKey: false,
  apiKeyPreview: null
};

const PUBLIC_IP_URL = "https://api64.ipify.org/?format=json";

export function proxycheckRequestUrl(apiKey: string, ipAddress: string): string {
  const url = new URL(
    `https://proxycheck.io/v2/${encodeURIComponent(ipAddress)}`
  );
  url.searchParams.set("key", apiKey);
  url.searchParams.set("vpn", "1");
  url.searchParams.set("risk", "1");
  return url.toString();
}

export async function fetchCurrentPublicIp(
  fetcher: typeof fetch = fetch
): Promise<string> {
  const response = await fetcher(PUBLIC_IP_URL, {
    method: "GET",
    cache: "no-store",
    credentials: "omit"
  });
  if (!response.ok) {
    throw new Error(`公网 IP 查询失败 HTTP ${response.status}`);
  }
  const json = (await response.json()) as unknown;
  const ip = typeof (json as { ip?: unknown })?.ip === "string"
    ? (json as { ip: string }).ip.trim()
    : "";
  if (!isIpLiteral(ip)) {
    throw new Error("公网 IP 查询返回格式无效");
  }
  return ip;
}

export async function fetchProxycheckIpRisk(
  apiKey: string,
  fetcher: typeof fetch = fetch,
  now = Date.now()
): Promise<IpRiskState> {
  const ipAddress = await fetchCurrentPublicIp(fetcher);
  const response = await fetcher(proxycheckRequestUrl(apiKey, ipAddress), {
    method: "GET",
    cache: "no-store",
    credentials: "omit"
  });
  if (!response.ok) {
    throw new Error(`proxycheck.io HTTP ${response.status}`);
  }
  return normalizeProxycheckResponse(await response.json(), now);
}

export function normalizeProxycheckResponse(
  value: unknown,
  now = Date.now()
): IpRiskState {
  const root = asRecord(value);
  if (!root) {
    throw new Error("proxycheck.io 返回格式无效");
  }

  const status = stringValue(root.status)?.toLowerCase() ?? "";
  if (status === "denied" || status === "error") {
    throw new Error(
      stringValue(root.message) ??
        stringValue(root.error) ??
        "proxycheck.io 拒绝了本次查询"
    );
  }

  const entry = findProxycheckEntry(root);
  if (!entry) {
    throw new Error("proxycheck.io 未返回 IP 风险条目");
  }

  const type = cleanString(entry.type);
  const typeLower = type?.toLowerCase() ?? "";
  const score = scoreValue(entry.risk ?? entry.risk_score ?? entry.score);
  const proxy = yes(entry.proxy) || typeLower.includes("proxy");
  const vpn = yes(entry.vpn) || typeLower.includes("vpn");
  const tor = yes(entry.tor) || typeLower.includes("tor");
  const hosting =
    yes(entry.hosting) ||
    yes(entry.datacenter) ||
    typeLower.includes("hosting") ||
    typeLower.includes("data center") ||
    typeLower.includes("datacenter");

  return {
    provider: "proxycheck",
    source: "proxycheck.io",
    status: "ok",
    updatedAt: now,
    score,
    label: ipRiskLabel(score),
    signals: {
      proxy,
      vpn,
      tor,
      hosting,
      type
    }
  };
}

export function disabledIpRiskState(now = Date.now()): IpRiskState {
  return {
    provider: "proxycheck",
    source: "proxycheck.io",
    status: "disabled",
    updatedAt: now,
    score: null,
    label: "未知",
    signals: emptySignals()
  };
}

export function missingKeyIpRiskState(now = Date.now()): IpRiskState {
  return {
    provider: "proxycheck",
    source: "proxycheck.io",
    status: "missing-key",
    updatedAt: now,
    score: null,
    label: "未知",
    signals: emptySignals()
  };
}

export function errorIpRiskState(
  message: string,
  now = Date.now()
): IpRiskState {
  return {
    provider: "proxycheck",
    source: "proxycheck.io",
    status: "error",
    updatedAt: now,
    score: null,
    label: "未知",
    signals: emptySignals(),
    errorMessage: message
  };
}

export function ipRiskLabel(score: number | null): IpRiskLabel {
  if (typeof score !== "number") {
    return "未知";
  }
  if (score >= 75) {
    return "严重";
  }
  if (score >= 50) {
    return "高";
  }
  if (score >= 25) {
    return "偏高";
  }
  return "正常";
}

export function sanitizeProxycheckApiKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256) {
    return null;
  }
  return trimmed;
}

export function publicIpRiskSettings(
  settings: IpRiskStoredSettings
): IpRiskPublicSettings {
  return {
    provider: "proxycheck",
    enabled: settings.enabled,
    hasApiKey: Boolean(settings.proxycheckApiKey),
    apiKeyPreview: maskProxycheckApiKey(settings.proxycheckApiKey)
  };
}

export function maskProxycheckApiKey(value: string | undefined): string | null {
  const apiKey = sanitizeProxycheckApiKey(value);
  if (!apiKey) {
    return null;
  }
  if (apiKey.length <= 4) {
    return "••••";
  }
  const suffix = apiKey.slice(-4);
  const hiddenLength = Math.min(Math.max(apiKey.length - 4, 6), 14);
  return `${"•".repeat(hiddenLength)}${suffix}`;
}

function findProxycheckEntry(
  root: Record<string, unknown>
): Record<string, unknown> | null {
  const hintedIp = stringValue(root.ip);
  if (hintedIp) {
    const hinted = asRecord(root[hintedIp]);
    if (hinted) {
      return hinted;
    }
  }

  for (const [key, value] of Object.entries(root)) {
    if (key === "status" || key === "ip" || key === "message" || key === "query time") {
      continue;
    }
    const entry = asRecord(value);
    if (entry && ("risk" in entry || "proxy" in entry || "type" in entry)) {
      return entry;
    }
  }
  return null;
}

function scoreValue(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function yes(value: unknown): boolean {
  if (value === true || value === 1) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "yes" || normalized === "true" || normalized === "1";
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 64) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function emptySignals(): IpRiskSignals {
  return {
    proxy: false,
    vpn: false,
    tor: false,
    hosting: false,
    type: null
  };
}

function isIpLiteral(value: string): boolean {
  return /^[0-9]{1,3}(?:\.[0-9]{1,3}){3}$/.test(value) || /^[0-9a-f:]+$/i.test(value);
}
