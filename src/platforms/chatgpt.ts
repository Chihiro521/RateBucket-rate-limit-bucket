import type {
  BridgeResponse,
  UsageEndpointFetcher,
  UsageMeter,
  UsageSnapshot,
  UsageSource
} from "./types";
import {
  asArray,
  asBoolean,
  asRecord,
  getArray,
  getNumber,
  getRecord,
  getString,
  percentFromRatioOrPercent,
  titleFromKey
} from "../utils/safeJson";
import { formatUsageError, usageErrorFromBridge } from "./errors";

const FEATURE_LABELS: Record<string, string> = {
  deep_research: "Deep Research",
  image_gen: "Image Generation",
  file_upload: "File Upload",
  odyssey: "Odyssey"
};

export function normalizeChatGptConversationInit(
  json: unknown,
  source: UsageSource = "api"
): {
  meters: UsageMeter[];
  defaultModelSlug?: string;
  blockedFeatures: string[];
} {
  const root = asRecord(json);
  if (!root) {
    return { meters: [], blockedFeatures: [] };
  }

  const meters: UsageMeter[] = [];
  for (const item of getArray(root, "limits_progress")) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    const featureName = getString(record, "feature_name") ?? "unknown_feature";
    const remaining = getNumber(record, "remaining");
    const resetAfter = record.reset_after;
    const resetAt =
      typeof resetAfter === "string" || typeof resetAfter === "number"
        ? resetAfter
        : null;
    meters.push({
      key: `limits_progress:${featureName}`,
      label: FEATURE_LABELS[featureName] ?? titleFromKey(featureName),
      remaining,
      resetAt,
      source,
      confidence: remaining !== null && resetAt !== null ? "high" : "medium",
      rawKind: "limits_progress"
    });
  }

  const defaultModelSlug = getString(root, "default_model_slug") ?? undefined;
  const blockedFeatures = asArray(root.blocked_features)
    .map((item) => (typeof item === "string" ? item : null))
    .filter((item): item is string => item !== null);

  return { meters, defaultModelSlug, blockedFeatures };
}

function normalizeWindowMeter(args: {
  key: string;
  label: string;
  record: Record<string, unknown>;
  source: UsageSource;
  rawKind: string;
}): UsageMeter | null {
  const usedPercent = percentFromRatioOrPercent(
    getNumber(args.record, "used_percent")
  );
  const resetAt = args.record.reset_at;
  const resetValue =
    typeof resetAt === "string" || typeof resetAt === "number" ? resetAt : null;
  const windowSeconds = getNumber(args.record, "limit_window_seconds");

  if (usedPercent === null && resetValue === null && windowSeconds === null) {
    return null;
  }

  return {
    key: args.key,
    label: args.label,
    usedPercent,
    resetAt: resetValue,
    windowSeconds,
    source: args.source,
    confidence: usedPercent !== null && resetValue !== null ? "high" : "medium",
    rawKind: args.rawKind
  };
}

export function normalizeChatGptWhamUsage(
  json: unknown,
  source: UsageSource = "api"
): UsageMeter[] {
  const root = asRecord(json);
  if (!root) {
    return [];
  }
  const meters: UsageMeter[] = [];
  const rateLimit = getRecord(root, "rate_limit");
  if (rateLimit) {
    const primary = getRecord(rateLimit, "primary_window");
    if (primary) {
      const meter = normalizeWindowMeter({
        key: "wham:primary_window",
        label: "Primary window",
        record: primary,
        source,
        rawKind: "rate_limit.primary_window"
      });
      if (meter) {
        meters.push(meter);
      }
    }
    const secondary = getRecord(rateLimit, "secondary_window");
    if (secondary) {
      const meter = normalizeWindowMeter({
        key: "wham:secondary_window",
        label: "Weekly window",
        record: secondary,
        source,
        rawKind: "rate_limit.secondary_window"
      });
      if (meter) {
        meters.push(meter);
      }
    }
  }

  const codeReviewRateLimit = getRecord(root, "code_review_rate_limit");
  const codeReviewPrimary = codeReviewRateLimit
    ? getRecord(codeReviewRateLimit, "primary_window")
    : null;
  if (codeReviewPrimary) {
    const meter = normalizeWindowMeter({
      key: "wham:code_review",
      label: "Code Review",
      record: codeReviewPrimary,
      source,
      rawKind: "code_review_rate_limit.primary_window"
    });
    if (meter) {
      meters.push(meter);
    }
  }

  const credits = getRecord(root, "credits");
  if (credits) {
    const unlimited = asBoolean(credits.unlimited);
    const balance = getNumber(credits, "balance");
    if (unlimited !== null || balance !== null || asBoolean(credits.has_credits) !== null) {
      meters.push({
        key: "wham:credits",
        label: unlimited ? "Credits (unlimited)" : "Credits",
        remaining: balance,
        source,
        confidence: balance !== null || unlimited === true ? "medium" : "low",
        rawKind: "credits"
      });
    }
  }

  return meters;
}

function normalizeTasksRateLimit(
  json: unknown,
  source: UsageSource = "api"
): UsageMeter[] {
  const root = asRecord(json);
  if (!root) {
    return [];
  }
  const meters: UsageMeter[] = [];
  const direct = normalizeWindowMeter({
    key: "tasks:rate_limit",
    label: "Tasks rate limit",
    record: root,
    source,
    rawKind: "tasks.rate_limit"
  });
  if (direct) {
    meters.push(direct);
  }
  return meters;
}

export function normalizeChatGptCodexSettingsUsage(
  json: unknown,
  source: UsageSource = "api"
): UsageMeter[] {
  const root = asRecord(json);
  if (!root) {
    return [];
  }

  const candidates = collectCodexUsageCandidates(root);
  const meters: UsageMeter[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const meter = normalizeCodexUsageObject(candidate.path, candidate.record, source);
    if (!meter || seen.has(meter.key)) {
      continue;
    }
    seen.add(meter.key);
    meters.push(meter);
  }

  return meters;
}

function collectCodexUsageCandidates(
  root: Record<string, unknown>
): Array<{ path: string; record: Record<string, unknown> }> {
  const queue: Array<{ path: string; value: unknown; depth: number }> = [
    { path: "codex", value: root, depth: 0 }
  ];
  const candidates: Array<{ path: string; record: Record<string, unknown> }> = [];

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || item.depth > 4) {
      continue;
    }
    const record = asRecord(item.value);
    if (!record) {
      continue;
    }
    if (isCodexUsageLike(record)) {
      candidates.push({ path: item.path, record });
    }
    for (const [key, value] of Object.entries(record)) {
      if (Array.isArray(value)) {
        value.forEach((entry, index) => {
          queue.push({
            path: `${item.path}.${key}.${index}`,
            value: entry,
            depth: item.depth + 1
          });
        });
      } else if (asRecord(value)) {
        queue.push({
          path: `${item.path}.${key}`,
          value,
          depth: item.depth + 1
        });
      }
    }
  }

  return candidates;
}

function isCodexUsageLike(record: Record<string, unknown>): boolean {
  return (
    numberFromKeys(record, ["remaining", "remaining_credits", "remainingCredits"]) !== null ||
    numberFromKeys(record, ["total", "limit", "quota", "total_credits", "totalCredits"]) !==
      null ||
    numberFromKeys(record, ["used", "usage", "used_credits", "usedCredits"]) !== null ||
    numberFromKeys(record, ["used_percent", "usedPercent", "utilization"]) !== null ||
    numberFromKeys(record, ["reset_after", "resetAfter", "reset_after_seconds"]) !== null ||
    stringOrNumberFromKeys(record, ["reset_at", "resetAt", "resets_at"]) !== null
  );
}

function normalizeCodexUsageObject(
  path: string,
  record: Record<string, unknown>,
  source: UsageSource
): UsageMeter | null {
  const remaining = numberFromKeys(record, [
    "remaining",
    "remaining_credits",
    "remainingCredits"
  ]);
  const total = numberFromKeys(record, [
    "total",
    "limit",
    "quota",
    "total_credits",
    "totalCredits"
  ]);
  const used =
    numberFromKeys(record, ["used", "usage", "used_credits", "usedCredits"]) ??
    (remaining !== null && total !== null ? Math.max(0, total - remaining) : null);
  const usedPercent = percentFromRatioOrPercent(
    numberFromKeys(record, ["used_percent", "usedPercent", "utilization"])
  );
  const resetAt = stringOrNumberFromKeys(record, ["reset_at", "resetAt", "resets_at"]);
  const resetAfterSeconds = numberFromKeys(record, [
    "reset_after",
    "resetAfter",
    "reset_after_seconds"
  ]);
  const label =
    getString(record, "label") ??
    getString(record, "name") ??
    getString(record, "feature_name") ??
    "Codex usage";

  if (
    remaining === null &&
    total === null &&
    used === null &&
    usedPercent === null &&
    resetAt === null &&
    resetAfterSeconds === null
  ) {
    return null;
  }

  return {
    key: `codex:${path}`,
    label: label === "Codex usage" ? label : `Codex ${titleFromKey(label)}`,
    remaining,
    total,
    used,
    usedPercent:
      usedPercent ??
      (used !== null && total !== null && total > 0
        ? percentFromRatioOrPercent(used / total)
        : null),
    resetAt,
    resetAfterSeconds,
    source,
    confidence:
      remaining !== null || total !== null || usedPercent !== null ? "medium" : "low",
    rawKind: "codex.settings.usage"
  };
}

function numberFromKeys(
  record: Record<string, unknown>,
  keys: string[]
): number | null {
  for (const key of keys) {
    const value = getNumber(record, key);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function stringOrNumberFromKeys(
  record: Record<string, unknown>,
  keys: string[]
): string | number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") {
      return value;
    }
  }
  return null;
}

function responseFailure(response: BridgeResponse): string {
  return formatUsageError(
    usageErrorFromBridge(response),
    response.endpointKey ?? "chatgpt"
  );
}

export async function fetchChatGptUsage(
  fetcher: UsageEndpointFetcher
): Promise<UsageSnapshot> {
  const meters: UsageMeter[] = [];
  const failures: string[] = [];
  let defaultModelSlug: string | undefined;
  let blockedFeatures: string[] = [];

  const conversation = await fetcher("chatgpt:conversationInit");
  if (conversation.ok) {
    const normalized = normalizeChatGptConversationInit(conversation.json, "api");
    meters.push(...normalized.meters);
    defaultModelSlug = normalized.defaultModelSlug;
    blockedFeatures = normalized.blockedFeatures;
  } else {
    failures.push(responseFailure(conversation));
  }

  const wham = await fetcher("chatgpt:whamUsage");
  if (wham.ok) {
    meters.push(...normalizeChatGptWhamUsage(wham.json, "api"));
  } else {
    failures.push(responseFailure(wham));
  }

  const tasks = await fetcher("chatgpt:whamTasksRateLimit");
  if (tasks.ok) {
    meters.push(...normalizeTasksRateLimit(tasks.json, "api"));
  }

  const codexUsage = await fetcher("chatgpt:codexSettingsUsage");
  if (codexUsage.ok) {
    meters.push(...normalizeChatGptCodexSettingsUsage(codexUsage.json, "api"));
  }

  const hasBlocking = blockedFeatures.length > 0;
  return {
    platform: "chatgpt",
    meters,
    source: meters.length > 0 ? "api" : "unknown",
    updatedAt: Date.now(),
    status:
      meters.length > 0
        ? failures.length > 0 || hasBlocking
          ? "partial"
          : "ok"
        : failures.length > 0
          ? "error"
          : "unknown",
    errorMessage: hasBlocking
      ? "部分功能被限制"
      : failures.length > 0
        ? failures[0]
        : undefined,
    debug: {
      endpoint: "chatgpt:conversationInit,chatgpt:whamUsage,chatgpt:codexSettingsUsage",
      parser: defaultModelSlug
        ? `chatgpt.default_model=${defaultModelSlug}`
        : "chatgpt"
    }
  };
}

export function normalizeChatGptIntercepted(
  url: string,
  json: unknown
): UsageMeter[] {
  const path = safePathname(url);
  if (path === "/backend-api/conversation/init") {
    return normalizeChatGptConversationInit(json, "intercepted").meters;
  }
  if (path === "/backend-api/wham/usage") {
    return normalizeChatGptWhamUsage(json, "intercepted");
  }
  if (path === "/backend-api/wham/tasks/rate_limit") {
    return normalizeTasksRateLimit(json, "intercepted");
  }
  if (path === "/codex/settings/usage") {
    return normalizeChatGptCodexSettingsUsage(json, "intercepted");
  }
  return [];
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}
