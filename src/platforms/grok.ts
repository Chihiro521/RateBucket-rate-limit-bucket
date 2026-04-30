import type {
  BridgeResponse,
  EndpointKey,
  UsageEndpointFetcher,
  UsageMeter,
  UsageSnapshot,
  UsageSource
} from "./types";
import {
  asRecord,
  getNumber,
  getRecord,
  percentFromRatioOrPercent
} from "../utils/safeJson";
import { formatUsageError, usageErrorFromBridge } from "./errors";

export const GROK_MODEL_CANDIDATES = [
  { modelName: "grok-3", endpointKey: "grok:grok-3", labelPrefix: "Grok" },
  {
    modelName: "grok-4-heavy",
    endpointKey: "grok:grok-4-heavy",
    labelPrefix: "Grok Heavy"
  }
] as const;

type GrokModelCandidate = (typeof GROK_MODEL_CANDIDATES)[number];

function makeMeter(args: {
  key: string;
  label: string;
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
    labelPrefix?: string;
    source?: UsageSource;
  } = {}
): UsageMeter[] {
  const record = asRecord(json);
  if (!record) {
    return [];
  }
  const source = options.source ?? "api";
  const modelName = options.modelName ?? "unknown";
  const labelPrefix = options.labelPrefix ?? "Grok";
  const windowSeconds = getNumber(record, "windowSizeSeconds");
  const meters: UsageMeter[] = [];

  const queryMeter = makeMeter({
    key: `${modelName}:queries`,
    label: `${labelPrefix} query limit`,
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
    key: `${modelName}:tokens`,
    label: `${labelPrefix} token limit`,
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
      key: `${modelName}:low-effort`,
      label: `${labelPrefix} Low / Fast / Normal`,
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
      key: `${modelName}:high-effort`,
      label: `${labelPrefix} High / Thinking / Expert`,
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

  for (const candidate of GROK_MODEL_CANDIDATES) {
    const response = await fetcher(candidate.endpointKey);
    if (!response.ok) {
      failures.push(responseFailure(response));
      continue;
    }
    meters.push(
      ...normalizeGrokRateLimit(response.json, {
        modelName: candidate.modelName,
        labelPrefix: candidate.labelPrefix,
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
      endpoint: GROK_MODEL_CANDIDATES.map((item) => item.endpointKey).join(","),
      parser: "grok.rateLimit"
    }
  };
}

export function candidateForEndpoint(
  endpointKey: EndpointKey | undefined
): GrokModelCandidate | undefined {
  return GROK_MODEL_CANDIDATES.find((item) => item.endpointKey === endpointKey);
}
