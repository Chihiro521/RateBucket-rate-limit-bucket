import { asBoolean, asRecord, getNumber, getString } from "../utils/safeJson";

export type ChatGPTSentinelUrlKind = "chat-requirements" | "prepare";

export type PowLevel =
  | "Unknown"
  | "Very Easy"
  | "Easy"
  | "Medium"
  | "Hard"
  | "Critical";

export type SentinelRiskLabel = "正常" | "偏高" | "高" | "严重";

export type ChatGPTSentinelObservation = {
  source: "chatgpt-sentinel";
  ts: number;
  urlKind: ChatGPTSentinelUrlKind;
  powRequired: boolean;
  powDifficulty: string | null;
};

export type PowRisk = {
  raw: string | null;
  clean: string | null;
  len: number | null;
  decimal: number | null;
  level: PowLevel;
  risk: number;
};

export type ChatGPTSentinelState = {
  updatedAt: number;
  sentinelRisk: {
    score: number;
    label: SentinelRiskLabel;
  };
  pow: PowRisk;
  gates: {
    powRequired: boolean;
  };
  explanation: string;
};

type SentinelRisk = {
  score: number;
  label: SentinelRiskLabel;
  pow: PowRisk;
  factors: {
    powRequired: boolean;
    powRequiredWithoutDifficulty: boolean;
  };
};

export const CHATGPT_SENTINEL_EVENT = "__AIQM_SENTINEL_EVENT__";

const CHAT_REQUIREMENTS_RE =
  /(?:^|\/)(?:backend-api|backend-anon|api)\/sentinel\/chat-requirements(?:\/prepare)?(?:\/?$|[?#])/i;

export function chatRequirementsUrlKind(
  rawUrl: string
): ChatGPTSentinelUrlKind | null {
  const normalized = safeUrlPathWithSearch(rawUrl);
  if (!CHAT_REQUIREMENTS_RE.test(normalized)) {
    return null;
  }
  return /\/prepare(?:\/?$|[?#])/i.test(normalized)
    ? "prepare"
    : "chat-requirements";
}

export function sanitizeSentinelResponse(
  data: unknown,
  rawUrl: string,
  now = Date.now()
): ChatGPTSentinelObservation | null {
  const urlKind = chatRequirementsUrlKind(rawUrl);
  if (!urlKind) {
    return null;
  }

  const dataRecord = asRecord(data);
  if (!dataRecord) {
    return null;
  }
  const root =
    asRecord(dataRecord.chat_requirements) ??
    asRecord(dataRecord.requirements) ??
    dataRecord;
  const pow =
    asRecord(root.proofofwork) ??
    asRecord(root.proof_of_work) ??
    asRecord(root.pow);

  return sanitizeSentinelObservation({
    source: "chatgpt-sentinel",
    ts: now,
    urlKind,
    powRequired: pow ? asBoolean(pow.required) === true : false,
    powDifficulty: pow ? getString(pow, "difficulty") : null
  });
}

export function sanitizeSentinelObservation(
  value: unknown
): ChatGPTSentinelObservation | null {
  const record = asRecord(value);
  if (!record || record.source !== "chatgpt-sentinel") {
    return null;
  }
  const urlKind = record.urlKind;
  if (urlKind !== "chat-requirements" && urlKind !== "prepare") {
    return null;
  }
  const ts = getNumber(record, "ts");
  if (ts === null) {
    return null;
  }
  const powDifficulty = getString(record, "powDifficulty");
  return {
    source: "chatgpt-sentinel",
    ts,
    urlKind,
    powRequired: asBoolean(record.powRequired) === true,
    powDifficulty
  };
}

export function parsePowRisk(difficulty: unknown): PowRisk {
  if (!difficulty || typeof difficulty !== "string") {
    return {
      raw: null,
      clean: null,
      len: null,
      decimal: null,
      level: "Unknown",
      risk: 0
    };
  }

  const clean = difficulty.replace(/^0x/i, "").replace(/^0+/, "") || "0";
  const len = clean.length;
  const parsed = Number.parseInt(clean, 16);
  const decimal = Number.isFinite(parsed) ? parsed : null;

  if (len <= 2) {
    return { raw: difficulty, clean, len, decimal, level: "Critical", risk: 100 };
  }
  if (len <= 3) {
    return { raw: difficulty, clean, len, decimal, level: "Hard", risk: 75 };
  }
  if (len <= 4) {
    return { raw: difficulty, clean, len, decimal, level: "Medium", risk: 50 };
  }
  if (len <= 5) {
    return { raw: difficulty, clean, len, decimal, level: "Easy", risk: 25 };
  }
  return { raw: difficulty, clean, len, decimal, level: "Very Easy", risk: 0 };
}

export function computeSentinelRisk(
  obs: ChatGPTSentinelObservation
): SentinelRisk {
  const pow = parsePowRisk(obs.powDifficulty);
  const powRequiredWithoutDifficulty = obs.powRequired === true && !obs.powDifficulty;

  const score = clamp(
    pow.risk + 10 * Number(powRequiredWithoutDifficulty)
  );

  const label: SentinelRiskLabel =
    score >= 75 ? "严重" : score >= 50 ? "高" : score >= 25 ? "偏高" : "正常";

  return {
    score,
    label,
    pow,
    factors: {
      powRequired: obs.powRequired,
      powRequiredWithoutDifficulty
    }
  };
}

export function toChatGPTSentinelState(
  obs: ChatGPTSentinelObservation
): ChatGPTSentinelState {
  const sentinel = computeSentinelRisk(obs);

  return {
    updatedAt: obs.ts,
    sentinelRisk: {
      score: sentinel.score,
      label: sentinel.label
    },
    pow: sentinel.pow,
    gates: {
      powRequired: obs.powRequired
    },
    explanation: "当前仅验证 PoW 难度，不判断模型 fallback。"
  };
}

export function containsForbiddenSentinelKey(value: unknown): boolean {
  const queue: unknown[] = [value];
  while (queue.length > 0) {
    const current = queue.shift();
    const record = asRecord(current);
    if (!record) {
      if (Array.isArray(current)) {
        queue.push(...current);
      }
      continue;
    }
    for (const [key, child] of Object.entries(record)) {
      if (isForbiddenSentinelKey(key)) {
        return true;
      }
      queue.push(child);
    }
  }
  return false;
}

function isForbiddenSentinelKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized === "token" ||
    normalized === "prepare_token" ||
    normalized === "dx" ||
    normalized === "collector_dx" ||
    normalized === "seed" ||
    normalized === "cookie" ||
    normalized === "authorization" ||
    normalized.startsWith("oai-") ||
    normalized.startsWith("x-oai-")
  );
}

function safeUrlPathWithSearch(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, "https://chatgpt.com");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return rawUrl;
  }
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}
