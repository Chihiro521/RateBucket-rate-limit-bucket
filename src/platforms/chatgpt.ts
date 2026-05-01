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
  displayAsRemaining?: boolean;
}): UsageMeter | null {
  const explicitRemainingPercent = percentFromRatioOrPercent(
    numberFromKeys(args.record, [
      "remaining_percent",
      "remainingPercent",
      "percent_remaining",
      "percentRemaining",
      "remaining_percentage",
      "remainingPercentage",
      "remaining_pct",
      "remainingPct"
    ])
  );
  const rawUsedPercent = percentFromRatioOrPercent(
    numberFromKeys(args.record, [
      "used_percent",
      "usedPercent",
      "used_percentage",
      "usedPercentage",
      "percent_used",
      "percentUsed",
      "utilization"
    ])
  );
  const remainingPercent =
    explicitRemainingPercent ??
    (args.displayAsRemaining && rawUsedPercent !== null
      ? percentFromRatioOrPercent(100 - rawUsedPercent)
      : null);
  const usedPercent =
    remainingPercent !== null
      ? percentFromRatioOrPercent(100 - remainingPercent)
      : rawUsedPercent;
  const resetValue = resetValueFromRecord(args.record);
  const windowSeconds = numberFromKeys(args.record, [
    "limit_window_seconds",
    "limitWindowSeconds",
    "window_seconds",
    "windowSeconds",
    "window_size_seconds",
    "windowSizeSeconds"
  ]);

  if (
    usedPercent === null &&
    remainingPercent === null &&
    resetValue === null &&
    windowSeconds === null
  ) {
    return null;
  }

  return {
    key: args.key,
    label: args.label,
    usedPercent,
    remainingPercent,
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
        rawKind: "rate_limit.primary_window",
        displayAsRemaining: true
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
        rawKind: "rate_limit.secondary_window",
        displayAsRemaining: true
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
      rawKind: "code_review_rate_limit.primary_window",
      displayAsRemaining: true
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

  meters.push(...normalizeAdditionalWhamUsageWindows(root, source));
  meters.push(...normalizeWhamCodexNamedUsage(root, source));

  return dedupeMeters(meters);
}

function normalizeAdditionalWhamUsageWindows(
  root: Record<string, unknown>,
  source: UsageSource
): UsageMeter[] {
  const knownPaths = new Set([
    "root.rate_limit.primary_window",
    "root.rate_limit.secondary_window",
    "root.code_review_rate_limit.primary_window",
    "root.credits"
  ]);
  return collectUsageCandidates(root, "root", {
    maxDepth: 7,
    includeRecord: (path, record) =>
      !knownPaths.has(path) && isGeneralChatGptUsageLike(path, record)
  })
    .map((candidate) =>
      normalizeGenericUsageObject(candidate.path, candidate.record, source, {
        keyPrefix: "wham",
        rawKind: "chatgpt.usage.window",
        displayAsRemaining: true
      })
    )
    .filter((meter): meter is UsageMeter => meter !== null);
}

function normalizeWhamCodexNamedUsage(
  root: Record<string, unknown>,
  source: UsageSource
): UsageMeter[] {
  const codexRoots = collectCodexNamedSubtrees(root);
  const meters: UsageMeter[] = [];
  const seen = new Set<string>();

  for (const item of codexRoots) {
    for (const meter of normalizeCodexUsageRecordTree(
      item.record,
      `wham.${item.path}`,
      source
    )) {
      if (seen.has(meter.key)) {
        continue;
      }
      seen.add(meter.key);
      meters.push(meter);
    }
  }

  return meters;
}

function collectCodexNamedSubtrees(
  root: Record<string, unknown>
): Array<{ path: string; record: Record<string, unknown> }> {
  const queue: Array<{ path: string; value: unknown; depth: number }> = [
    { path: "root", value: root, depth: 0 }
  ];
  const matches: Array<{ path: string; record: Record<string, unknown> }> = [];

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || item.depth > 4) {
      continue;
    }
    const record = asRecord(item.value);
    if (!record) {
      continue;
    }

    for (const [key, value] of Object.entries(record)) {
      const path = `${item.path}.${key}`;
      const childRecord = asRecord(value);
      if (childRecord) {
        if (isCodexPath(path)) {
          matches.push({ path, record: childRecord });
        }
        queue.push({ path, value, depth: item.depth + 1 });
      } else if (Array.isArray(value)) {
        value.forEach((entry, index) => {
          queue.push({
            path: `${path}.${index}`,
            value: entry,
            depth: item.depth + 1
          });
        });
      }
    }
  }

  return matches;
}

function isCodexPath(path: string): boolean {
  const normalized = path.toLowerCase();
  return normalized.includes("codex") && !normalized.includes("code_review");
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

  return normalizeCodexUsageRecordTree(root, "codex", source);
}

function normalizeCodexUsageRecordTree(
  root: Record<string, unknown>,
  rootPath: string,
  source: UsageSource
): UsageMeter[] {
  const candidates = collectCodexUsageCandidates(root, rootPath);
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
  root: Record<string, unknown>,
  rootPath: string
): Array<{ path: string; record: Record<string, unknown> }> {
  return collectUsageCandidates(root, rootPath, {
    maxDepth: 7,
    includeRecord: (_path, record) => isCodexUsageLike(record)
  });
}

function isCodexUsageLike(record: Record<string, unknown>): boolean {
  return (
    numberFromKeys(record, ["remaining", "remaining_credits", "remainingCredits"]) !== null ||
    numberFromKeys(record, ["total", "limit", "quota", "total_credits", "totalCredits"]) !==
      null ||
    numberFromKeys(record, ["used", "usage", "used_credits", "usedCredits"]) !== null ||
    numberFromKeys(record, ["used_percent", "usedPercent", "utilization"]) !== null ||
    numberFromKeys(record, [
      "remaining_percent",
      "remainingPercent",
      "percent_remaining",
      "percentRemaining",
      "remaining_percentage",
      "remainingPercentage"
    ]) !== null ||
    numberFromKeys(record, ["reset_after", "resetAfter", "reset_after_seconds"]) !== null ||
    stringOrNumberFromKeys(record, ["reset_at", "resetAt", "resets_at"]) !== null
  );
}

function isGeneralChatGptUsageLike(
  path: string,
  record: Record<string, unknown>
): boolean {
  if (isCodexPath(path)) {
    return false;
  }
  if (!isCodexUsageLike(record)) {
    return false;
  }
  const normalizedPath = path.toLowerCase();
  const label = usageLabel(record, path).toLowerCase();
  const hasUsageNameSignal =
    normalizedPath.includes("limit") ||
    normalizedPath.includes("window") ||
    normalizedPath.includes("usage") ||
    normalizedPath.includes("quota") ||
    normalizedPath.includes("bucket") ||
    label.includes("limit") ||
    label.includes("window") ||
    label.includes("usage") ||
    label.includes("额度") ||
    label.includes("使用限额");
  const hasCountQuotaSignal =
    numberFromKeys(record, ["remaining", "remaining_credits", "remainingCredits"]) !==
      null &&
    numberFromKeys(record, [
      "total",
      "limit",
      "quota",
      "total_credits",
      "totalCredits"
    ]) !== null;
  const hasCurrentWindowSignal =
    hasCountQuotaSignal ||
    numberFromKeys(record, [
      "remaining_percent",
      "remainingPercent",
      "percent_remaining",
      "percentRemaining",
      "remaining_percentage",
      "remainingPercentage",
      "remaining_pct",
      "remainingPct",
      "used_percent",
      "usedPercent",
      "used_percentage",
      "usedPercentage",
      "percent_used",
      "percentUsed",
      "utilization"
    ]) !== null ||
    resetValueFromRecord(record) !== null ||
    numberFromKeys(record, [
      "reset_after",
      "resetAfter",
      "reset_after_seconds",
      "limit_window_seconds",
      "limitWindowSeconds",
      "window_seconds",
      "windowSeconds",
      "window_size_seconds",
      "windowSizeSeconds"
    ]) !== null;
  return hasUsageNameSignal && hasCurrentWindowSignal;
}

function normalizeCodexUsageObject(
  path: string,
  record: Record<string, unknown>,
  source: UsageSource
): UsageMeter | null {
  return normalizeGenericUsageObject(path, record, source, {
    keyPrefix: "codex",
    rawKind: "codex.settings.usage",
    displayAsRemaining: true
  });
}

function normalizeGenericUsageObject(
  path: string,
  record: Record<string, unknown>,
  source: UsageSource,
  options: {
    keyPrefix: string;
    rawKind: string;
    displayAsRemaining: boolean;
  }
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
  const explicitRemainingPercent = percentFromRatioOrPercent(
    numberFromKeys(record, [
      "remaining_percent",
      "remainingPercent",
      "percent_remaining",
      "percentRemaining",
      "remaining_percentage",
      "remainingPercentage",
      "remaining_pct",
      "remainingPct"
    ])
  );
  const rawUsedPercent = percentFromRatioOrPercent(
    numberFromKeys(record, [
      "used_percent",
      "usedPercent",
      "used_percentage",
      "usedPercentage",
      "percent_used",
      "percentUsed",
      "utilization"
    ])
  );
  const remainingPercent =
    explicitRemainingPercent ??
    (options.displayAsRemaining && rawUsedPercent !== null
      ? percentFromRatioOrPercent(100 - rawUsedPercent)
      : null);
  const usedPercent =
    remainingPercent !== null
      ? percentFromRatioOrPercent(100 - remainingPercent)
      : rawUsedPercent;
  const resetAt = resetValueFromRecord(record);
  const resetAfterSeconds = numberFromKeys(record, [
    "reset_after",
    "resetAfter",
    "reset_after_seconds"
  ]);
  const windowSeconds = numberFromKeys(record, [
    "limit_window_seconds",
    "limitWindowSeconds",
    "window_seconds",
    "windowSeconds",
    "window_size_seconds",
    "windowSizeSeconds"
  ]);
  const label = usageLabel(record, path);

  if (
    remaining === null &&
    total === null &&
    used === null &&
    usedPercent === null &&
    remainingPercent === null &&
    resetAt === null &&
    resetAfterSeconds === null &&
    windowSeconds === null
  ) {
    return null;
  }

  return {
    key: `${options.keyPrefix}:${path}`,
    label,
    remaining,
    total,
    used,
    usedPercent:
      usedPercent ??
      (used !== null && total !== null && total > 0
        ? percentFromRatioOrPercent(used / total)
        : null),
    remainingPercent:
      remainingPercent ??
      (remaining !== null && total !== null && total > 0
        ? percentFromRatioOrPercent(remaining / total)
        : null),
    resetAt,
    resetAfterSeconds,
    windowSeconds,
    source,
    confidence:
      remaining !== null ||
      total !== null ||
      usedPercent !== null ||
      remainingPercent !== null
        ? "medium"
        : "low",
    rawKind: options.rawKind
  };
}

function collectUsageCandidates(
  root: Record<string, unknown>,
  rootPath: string,
  options: {
    maxDepth: number;
    includeRecord: (path: string, record: Record<string, unknown>) => boolean;
  }
): Array<{ path: string; record: Record<string, unknown> }> {
  const queue: Array<{ path: string; value: unknown; depth: number }> = [
    { path: rootPath, value: root, depth: 0 }
  ];
  const candidates: Array<{ path: string; record: Record<string, unknown> }> = [];

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || item.depth > options.maxDepth) {
      continue;
    }
    const record = asRecord(item.value);
    if (!record) {
      continue;
    }
    if (options.includeRecord(item.path, record)) {
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

function usageLabel(record: Record<string, unknown>, path: string): string {
  const direct =
    getString(record, "label") ??
    getString(record, "title") ??
    getString(record, "name") ??
    getString(record, "display_name") ??
    getString(record, "displayName") ??
    getString(record, "feature_name") ??
    getString(record, "bucket_name") ??
    getString(record, "bucketName") ??
    getString(record, "limit_name") ??
    getString(record, "limitName");
  if (direct) {
    const titled = displayUsageLabel(direct);
    if (
      path.toLowerCase().includes("codex") &&
      isSimpleUsageKey(direct) &&
      !/codex|gpt/i.test(titled)
    ) {
      return `Codex ${titled}`;
    }
    return titled;
  }

  const model =
    getString(record, "model") ??
    getString(record, "model_name") ??
    getString(record, "modelName") ??
    getString(record, "model_slug") ??
    getString(record, "modelSlug");
  const windowName =
    getString(record, "window") ??
    getString(record, "window_name") ??
    getString(record, "windowName") ??
    getString(record, "period") ??
    getString(record, "period_name") ??
    getString(record, "periodName");
  if (model && windowName) {
    return `${model} ${titleFromKey(windowName)} 使用限额`;
  }
  if (model) {
    return `${model} 使用限额`;
  }

  const normalizedPath = path.toLowerCase();
  if (normalizedPath === "codex" || normalizedPath.includes("codex_usage")) {
    return "Codex usage";
  }

  const pathLabel = path
    .split(".")
    .filter((part) => part !== "root" && !/^\d+$/.test(part))
    .slice(-3)
    .join(" ");
  return pathLabel ? titleFromKey(pathLabel) : "Codex usage";
}

function displayUsageLabel(value: string): string {
  const trimmed = value.trim();
  if (!isSimpleUsageKey(trimmed)) {
    return trimmed;
  }
  return titleFromKey(trimmed);
}

function isSimpleUsageKey(value: string): boolean {
  return /^[A-Za-z0-9_]+$/.test(value.trim());
}

function resetValueFromRecord(record: Record<string, unknown>): string | number | null {
  return stringOrNumberFromKeys(record, [
    "reset_at",
    "resetAt",
    "resets_at",
    "resetsAt",
    "reset_time",
    "resetTime",
    "resets"
  ]);
}

function dedupeMeters(meters: UsageMeter[]): UsageMeter[] {
  const seen = new Set<string>();
  const result: UsageMeter[] = [];
  for (const meter of meters) {
    if (seen.has(meter.key)) {
      continue;
    }
    seen.add(meter.key);
    result.push(meter);
  }
  return result;
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
  const requiredFailures: string[] = [];
  const optionalFailures: string[] = [];
  let defaultModelSlug: string | undefined;
  let blockedFeatures: string[] = [];

  const conversation = await fetcher("chatgpt:conversationInit");
  if (conversation.ok) {
    const normalized = normalizeChatGptConversationInit(conversation.json, "api");
    meters.push(...normalized.meters);
    defaultModelSlug = normalized.defaultModelSlug;
    blockedFeatures = normalized.blockedFeatures;
  } else {
    requiredFailures.push(responseFailure(conversation));
  }

  const wham = await fetcher("chatgpt:whamUsage");
  if (wham.ok) {
    meters.push(...normalizeChatGptWhamUsage(wham.json, "api"));
  } else {
    optionalFailures.push(responseFailure(wham));
  }

  const tasks = await fetcher("chatgpt:whamTasksRateLimit");
  if (tasks.ok) {
    meters.push(...normalizeTasksRateLimit(tasks.json, "api"));
  } else {
    optionalFailures.push(responseFailure(tasks));
  }

  const codexUsage = await fetcher("chatgpt:codexSettingsUsage");
  if (codexUsage.ok) {
    meters.push(...normalizeChatGptCodexSettingsUsage(codexUsage.json, "api"));
  } else {
    optionalFailures.push(responseFailure(codexUsage));
  }

  const hasBlocking = blockedFeatures.length > 0;
  const hasOptionalFailures = optionalFailures.length > 0;
  const firstFailure = requiredFailures[0] ?? optionalFailures[0];
  return {
    platform: "chatgpt",
    meters,
    source: meters.length > 0 ? "api" : "unknown",
    updatedAt: Date.now(),
    status:
      meters.length > 0
        ? hasOptionalFailures || hasBlocking
          ? "partial"
          : "ok"
        : firstFailure
          ? "error"
          : "unknown",
    errorMessage: hasBlocking
      ? "部分功能被限制"
      : meters.length === 0 && firstFailure
        ? firstFailure
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
