import type {
  BridgeResponse,
  UsageRequestContext,
  UsageEndpointFetcher,
  UsageMeter,
  UsageSnapshot,
  UsageSource
} from "./types";
import {
  asRecord,
  getNumber,
  getRecord,
  getString,
  percentFromRatioOrPercent
} from "../utils/safeJson";
import { formatUsageError, usageErrorFromBridge } from "./errors";

const GROK_ENDPOINT_KEY = "grok:rate-limits" as const;
const MAX_OBSERVED_CONTEXTS = 12;
const DEFAULT_REQUEST_KIND = "DEFAULT";

type GrokRateLimitContext = {
  modelName: string;
  requestKind?: string;
};

const observedContexts = new Map<string, GrokRateLimitContext>();

function makeMeter(args: {
  key: string;
  label: string;
  modelName?: string;
  requestKind?: string;
  remaining: number | null;
  total: number | null;
  windowSeconds: number | null;
  resetAfterSeconds?: number | null;
  source: UsageSource;
  rawKind: string;
}): UsageMeter | null {
  const explicitResetAfterSeconds = args.resetAfterSeconds ?? null;
  if (
    args.remaining === null &&
    args.total === null &&
    explicitResetAfterSeconds === null
  ) {
    return null;
  }
  const used =
    args.remaining !== null && args.total !== null
      ? Math.max(0, args.total - args.remaining)
      : null;
  const usedPercent =
    used !== null && args.total !== null && args.total > 0
      ? percentFromRatioOrPercent(used / args.total)
      : null;
  const confidence =
    args.remaining !== null && args.total !== null
      ? "high"
      : args.resetAfterSeconds !== null || args.windowSeconds !== null
        ? "medium"
        : "low";

  return {
    key: args.key,
    label: args.label,
    modelName: args.modelName,
    requestKind: args.requestKind,
    remaining: args.remaining,
    total: args.total,
    used,
    usedPercent,
    resetAfterSeconds: explicitResetAfterSeconds ?? args.windowSeconds,
    windowSeconds: args.windowSeconds,
    source: args.source,
    confidence,
    rawKind: args.rawKind
  };
}

export function normalizeGrokRateLimit(
  json: unknown,
  options: {
    modelName?: string;
    requestKind?: string;
    labelPrefix?: string;
    source?: UsageSource;
  } = {}
): UsageMeter[] {
  const record = asRecord(json);
  if (!record) {
    return [];
  }
  const source = options.source ?? "api";
  const modelName =
    getString(record, "modelName") ??
    getString(record, "model") ??
    getString(record, "modelId") ??
    options.modelName ??
    "unknown";
  const requestKind =
    getString(record, "requestKind") ??
    getString(record, "kind") ??
    options.requestKind ??
    DEFAULT_REQUEST_KIND;
  const displayName =
    getString(record, "displayName") ?? getString(record, "modelDisplayName");
  const labelPrefix = options.labelPrefix ?? displayName ?? modelName;
  const meterKeyPrefix = grokMeterKeyPrefix(modelName, requestKind);
  const requestKindLabel = requestKind === DEFAULT_REQUEST_KIND ? "" : ` · ${requestKind}`;
  const windowSeconds = getNumber(record, "windowSizeSeconds");
  const meters: UsageMeter[] = [];

  const queryMeter = makeMeter({
    key: `${meterKeyPrefix}:queries`,
    label: `${labelPrefix}${requestKindLabel} query limit`,
    modelName,
    requestKind,
    remaining: getNumber(record, "remainingQueries"),
    total: getNumber(record, "totalQueries"),
    windowSeconds,
    source,
    rawKind: "queries"
  });
  if (queryMeter) {
    meters.push(queryMeter);
  }

  const tokenMeter = makeMeter({
    key: `${meterKeyPrefix}:tokens`,
    label: `${labelPrefix}${requestKindLabel} token limit`,
    modelName,
    requestKind,
    remaining: getNumber(record, "remainingTokens"),
    total: getNumber(record, "totalTokens"),
    windowSeconds,
    source,
    rawKind: "tokens"
  });
  if (tokenMeter) {
    meters.push(tokenMeter);
  }

  const lowEffort = getRecord(record, "lowEffortRateLimits");
  if (lowEffort) {
    const meter = makeMeter({
      key: `${meterKeyPrefix}:low-effort`,
      label: `${labelPrefix}${requestKindLabel} Low / Fast / Normal`,
      modelName,
      requestKind,
      remaining: getNumber(lowEffort, "remainingQueries"),
      total: getNumber(lowEffort, "totalQueries"),
      windowSeconds,
      resetAfterSeconds: getNumber(lowEffort, "waitTimeSeconds"),
      source,
      rawKind: "lowEffortRateLimits"
    });
    if (meter) {
      meters.push(meter);
    }
  }

  const highEffort = getRecord(record, "highEffortRateLimits");
  if (highEffort) {
    const meter = makeMeter({
      key: `${meterKeyPrefix}:high-effort`,
      label: `${labelPrefix}${requestKindLabel} High / Thinking / Expert`,
      modelName,
      requestKind,
      remaining: getNumber(highEffort, "remainingQueries"),
      total: getNumber(highEffort, "totalQueries"),
      windowSeconds,
      resetAfterSeconds: getNumber(highEffort, "waitTimeSeconds"),
      source,
      rawKind: "highEffortRateLimits"
    });
    if (meter) {
      meters.push(meter);
    }
  }

  return meters;
}

export function grokRateLimitContextFromJson(
  json: unknown
): UsageRequestContext | undefined {
  const record = asRecord(json);
  if (!record) {
    return undefined;
  }
  const modelName =
    getString(record, "modelName") ??
    getString(record, "model") ??
    getString(record, "modelId");
  const requestKind =
    getString(record, "requestKind") ?? getString(record, "kind");
  if (!modelName && !requestKind) {
    return undefined;
  }
  return {
    modelName: modelName ?? undefined,
    requestKind: requestKind ?? undefined
  };
}

function responseFailure(response: BridgeResponse): string {
  return formatUsageError(
    usageErrorFromBridge(response),
    response.endpointKey ?? "grok"
  );
}

export async function fetchGrokUsage(
  fetcher: UsageEndpointFetcher
): Promise<UsageSnapshot> {
  const meters: UsageMeter[] = [];
  const failures: string[] = [];
  const latestContext = getLatestObservedGrokRateLimitContext();
  const contexts = latestContext ? [latestContext] : [];

  if (contexts.length === 0) {
    return {
      platform: "grok",
      meters,
      source: "unknown",
      updatedAt: Date.now(),
      status: "unknown",
      debug: {
        endpoint: GROK_ENDPOINT_KEY,
        parser: "grok.rateLimit.dynamic"
      }
    };
  }

  for (const context of contexts) {
    const response = await fetcher(GROK_ENDPOINT_KEY, {
      modelName: context.modelName,
      requestKind: context.requestKind ?? DEFAULT_REQUEST_KIND
    });
    if (!response.ok) {
      failures.push(responseFailure(response));
      continue;
    }
    meters.push(
      ...normalizeGrokRateLimit(response.json, {
        modelName: context.modelName,
        requestKind: context.requestKind,
        source: "api"
      })
    );
  }

  return {
    platform: "grok",
    meters,
    source: meters.length > 0 ? "api" : "unknown",
    updatedAt: Date.now(),
    status:
      meters.length > 0
        ? failures.length > 0
          ? "partial"
          : "ok"
        : failures.length > 0
          ? "error"
          : "unknown",
    errorMessage: failures[0],
    debug: {
      endpoint: contexts
        .map(
          (context) =>
            `${GROK_ENDPOINT_KEY}:${context.modelName}:${context.requestKind ?? DEFAULT_REQUEST_KIND}`
        )
        .join(","),
      parser: "grok.rateLimit.dynamic"
    }
  };
}

export function rememberGrokRateLimitContext(
  context: UsageRequestContext | undefined
): void {
  if (!context?.modelName || !isSafeGrokModelName(context.modelName)) {
    return;
  }
  const requestKind = isSafeGrokRequestKind(context.requestKind)
    ? context.requestKind
    : DEFAULT_REQUEST_KIND;
  const normalized = {
    modelName: context.modelName,
    requestKind
  };
  const key = contextKey(normalized);
  observedContexts.delete(key);
  observedContexts.set(key, normalized);
  while (observedContexts.size > MAX_OBSERVED_CONTEXTS) {
    const oldestKey = observedContexts.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }
    observedContexts.delete(oldestKey);
  }
}

export function getObservedGrokRateLimitContexts(): GrokRateLimitContext[] {
  return [...observedContexts.values()];
}

export function getLatestObservedGrokRateLimitContext():
  | GrokRateLimitContext
  | undefined {
  const contexts = getObservedGrokRateLimitContexts();
  return contexts[contexts.length - 1];
}

export function clearObservedGrokRateLimitContexts(): void {
  observedContexts.clear();
}

function grokMeterKeyPrefix(modelName: string, requestKind: string): string {
  return `${modelName}:${requestKind.toLowerCase()}`;
}

function contextKey(context: GrokRateLimitContext): string {
  return grokMeterKeyPrefix(
    context.modelName,
    context.requestKind ?? DEFAULT_REQUEST_KIND
  );
}

function isSafeGrokModelName(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,120}$/.test(value);
}

function isSafeGrokRequestKind(value: string | undefined): value is string {
  return value !== undefined && /^[A-Z_]{1,40}$/.test(value);
}
