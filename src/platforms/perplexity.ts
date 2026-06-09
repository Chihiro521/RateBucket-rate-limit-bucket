import type {
  BridgeResponse,
  UsageEndpointFetcher,
  UsageMeter,
  UsageSnapshot,
  UsageSource
} from "./types";
import { asRecord, getNumber, titleFromKey } from "../utils/safeJson";
import { formatUsageError, usageErrorFromBridge } from "./errors";

export const PERPLEXITY_ENDPOINT_KEY = "perplexity:rateLimitAll" as const;

const FIELD_METERS: Array<{
  field: string;
  key: string;
  label: string;
}> = [
  {
    field: "remaining_pro",
    key: "perplexity:pro",
    label: "Pro"
  },
  {
    field: "remaining_research",
    key: "perplexity:research",
    label: "Deep Research"
  },
  {
    field: "remaining_labs",
    key: "perplexity:labs",
    label: "Labs"
  },
  {
    field: "remaining_agentic_research",
    key: "perplexity:agentic-research",
    label: "Agentic Research"
  },
  {
    field: "free_queries",
    key: "perplexity:free-queries",
    label: "Free queries"
  }
];

export function normalizePerplexityRateLimit(
  json: unknown,
  source: UsageSource = "api"
): UsageMeter[] {
  const root = asRecord(json);
  if (!root) {
    return [];
  }

  const meters = FIELD_METERS.flatMap((definition) => {
    const remaining = getNumber(root, definition.field);
    return remaining === null
      ? []
      : [
          makeRemainingMeter({
            key: definition.key,
            label: definition.label,
            remaining,
            source,
            rawKind: definition.field
          })
        ];
  });

  meters.push(...normalizeModelSpecificLimits(root.model_specific_limits, source));
  return meters;
}

export async function fetchPerplexityUsage(
  fetcher: UsageEndpointFetcher
): Promise<UsageSnapshot> {
  const response = await fetcher(PERPLEXITY_ENDPOINT_KEY);
  if (!response.ok) {
    return {
      platform: "perplexity",
      meters: [],
      source: "unknown",
      updatedAt: Date.now(),
      status: "error",
      errorMessage: responseFailure(response),
      debug: {
        endpoint: PERPLEXITY_ENDPOINT_KEY,
        parser: "perplexity.rateLimitAll"
      }
    };
  }

  const meters = normalizePerplexityRateLimit(response.json, "api");
  return {
    platform: "perplexity",
    meters,
    source: meters.length > 0 ? "api" : "unknown",
    updatedAt: Date.now(),
    status: meters.length > 0 ? "ok" : "error",
    errorMessage:
      meters.length > 0 ? undefined : "Perplexity rate-limit fields missing",
    debug: {
      endpoint: PERPLEXITY_ENDPOINT_KEY,
      parser: "perplexity.rateLimitAll"
    }
  };
}

function normalizeModelSpecificLimits(
  value: unknown,
  source: UsageSource
): UsageMeter[] {
  const limits = asRecord(value);
  if (!limits) {
    return [];
  }

  const meters: UsageMeter[] = [];
  for (const [modelName, rawLimit] of Object.entries(limits)) {
    const limit = asRecord(rawLimit);
    if (!limit) {
      continue;
    }
    const remaining =
      getNumber(limit, "remaining") ??
      getNumber(limit, "remaining_queries") ??
      getNumber(limit, "remainingQueries");
    const total =
      getNumber(limit, "limit") ??
      getNumber(limit, "total") ??
      getNumber(limit, "total_queries") ??
      getNumber(limit, "totalQueries");
    if (remaining === null) {
      continue;
    }
    meters.push(
      makeRemainingMeter({
        key: `perplexity:model:${modelName}`,
        label: `${titleFromKey(modelName)} model limit`,
        modelName,
        remaining,
        total,
        source,
        rawKind: `model_specific_limits.${modelName}`
      })
    );
  }
  return meters;
}

function makeRemainingMeter(args: {
  key: string;
  label: string;
  modelName?: string;
  remaining: number | null;
  total?: number | null;
  source: UsageSource;
  rawKind: string;
}): UsageMeter {
  const total = args.total ?? null;
  const used =
    args.remaining !== null && total !== null
      ? Math.max(0, total - args.remaining)
      : null;
  const usedPercent =
    used !== null && total !== null && total > 0 ? (used / total) * 100 : null;
  const remainingPercent =
    args.remaining !== null && total !== null && total > 0
      ? Math.max(0, Math.min(100, (args.remaining / total) * 100))
      : null;

  return {
    key: args.key,
    label: args.label,
    modelName: args.modelName,
    remaining: args.remaining,
    total,
    used,
    usedPercent,
    remainingPercent,
    source: args.source,
    confidence: total !== null ? "high" : "medium",
    rawKind: args.rawKind
  };
}

function responseFailure(response: BridgeResponse): string {
  return formatUsageError(
    usageErrorFromBridge(response),
    response.endpointKey ?? "perplexity"
  );
}
