import type {
  BridgeResponse,
  UsageEndpointFetcher,
  UsageMeter,
  UsageSnapshot,
  UsageSource
} from "./types";
import { asArray, asNumber, percentFromRatioOrPercent } from "../utils/safeJson";
import { formatUsageError, usageErrorFromBridge } from "./errors";

const GEMINI_ENDPOINT_KEY = "gemini:usageBatchExecute" as const;
const GEMINI_USAGE_RPC_ID = "jSf9Qc";

export type GeminiUsageParseResult = {
  meters: UsageMeter[];
  payloadStatus?: number;
  errorStatus?: number;
  errorMessage?: string;
};

export function parseGeminiBatchExecuteFrames(text: string): unknown[] {
  const withoutXssi = text.startsWith(")]}'") ? text.slice(4) : text;
  const frames: unknown[] = [];

  for (const line of withoutXssi.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^\d+$/.test(trimmed)) {
      continue;
    }
    frames.push(JSON.parse(trimmed));
  }

  return frames;
}

export function normalizeGeminiUsageText(
  text: string,
  source: UsageSource = "api"
): GeminiUsageParseResult {
  let frames: unknown[];
  try {
    frames = parseGeminiBatchExecuteFrames(text);
  } catch {
    return {
      meters: [],
      errorMessage: "Gemini batchexecute 响应结构变化"
    };
  }

  const errorStatus = findGeminiErrorStatus(frames);
  if (errorStatus !== null) {
    return {
      meters: [],
      errorStatus,
      errorMessage: `Gemini usage RPC failed (${errorStatus})`
    };
  }

  const payloadString = findWrbPayloadString(frames);
  if (!payloadString) {
    return {
      meters: [],
      errorMessage: "Gemini usage payload missing"
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(payloadString);
  } catch {
    return {
      meters: [],
      errorMessage: "Gemini usage payload parse failed"
    };
  }

  const values = asArray(payload);
  const payloadStatus = asNumber(values[0]) ?? undefined;
  const buckets = asArray(values[1]);
  const meters = buckets
    .map((bucket) => normalizeGeminiBucket(bucket, source))
    .filter((meter): meter is UsageMeter => meter !== null);

  return {
    meters,
    payloadStatus,
    errorMessage: meters.length === 0 ? "Gemini usage buckets missing" : undefined
  };
}

export async function fetchGeminiUsage(
  fetcher: UsageEndpointFetcher
): Promise<UsageSnapshot> {
  const response = await fetcher(GEMINI_ENDPOINT_KEY);
  if (!response.ok) {
    const missingReplayParams =
      response.error?.message === "Missing Gemini usage replay parameters";
    return {
      platform: "gemini",
      meters: [],
      source: "unknown",
      updatedAt: Date.now(),
      status: missingReplayParams ? "unknown" : "error",
      errorMessage: missingReplayParams
        ? "等待 Gemini 页面用量参数"
        : responseFailure(response),
      debug: {
        endpoint: GEMINI_ENDPOINT_KEY,
        parser: "gemini.batchexecute"
      }
    };
  }

  if (typeof response.text !== "string") {
    return {
      platform: "gemini",
      meters: [],
      source: "unknown",
      updatedAt: Date.now(),
      status: "error",
      errorMessage: "Gemini usage response text missing",
      debug: {
        endpoint: GEMINI_ENDPOINT_KEY,
        parser: "gemini.batchexecute"
      }
    };
  }

  const parsed = normalizeGeminiUsageText(response.text, "api");
  return {
    platform: "gemini",
    meters: parsed.meters,
    source: parsed.meters.length > 0 ? "api" : "unknown",
    updatedAt: Date.now(),
    status: parsed.meters.length > 0 ? "ok" : "error",
    errorMessage: parsed.errorMessage,
    debug: {
      endpoint: GEMINI_ENDPOINT_KEY,
      parser:
        parsed.payloadStatus !== undefined
          ? `gemini.status=${parsed.payloadStatus}`
          : "gemini.batchexecute"
    }
  };
}

function normalizeGeminiBucket(
  value: unknown,
  source: UsageSource
): UsageMeter | null {
  const bucket = asArray(value);
  const remaining = asNumber(bucket[0]);
  const ratio = asNumber(bucket[1]);
  const type = asNumber(bucket[2]);
  const resetAt = resetAtFromBucket(bucket[3]);

  if (remaining === null || ratio === null || type === null) {
    return null;
  }

  const usedPercent = percentFromRatioOrPercent(ratio);
  const remainingPercent =
    usedPercent === null ? null : clampPercent(100 - usedPercent);
  const total = ratio >= 0 && ratio < 1 ? Math.round(remaining / (1 - ratio)) : null;
  const label = labelForBucketType(type);

  return {
    key: keyForBucketType(type),
    label,
    remaining,
    total,
    used:
      total !== null ? Math.max(0, Math.round(total - remaining)) : null,
    usedPercent,
    remainingPercent,
    resetAt,
    windowSeconds: windowSecondsForBucketType(type),
    source,
    confidence: resetAt !== null ? "high" : "medium",
    rawKind: `type:${type}`
  };
}

function resetAtFromBucket(value: unknown): number | null {
  const timestamp = asArray(asArray(value)[0]);
  const sec = asNumber(timestamp[0]);
  const nano = asNumber(timestamp[1]) ?? 0;
  if (sec === null) {
    return null;
  }
  return Math.round((sec + nano / 1_000_000_000) * 1000);
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function labelForBucketType(type: number): string {
  if (type === 1) {
    return "Gemini 5h";
  }
  if (type === 2) {
    return "Gemini weekly";
  }
  return `Gemini bucket ${type}`;
}

function keyForBucketType(type: number): string {
  if (type === 1) {
    return "gemini:5h";
  }
  if (type === 2) {
    return "gemini:weekly";
  }
  return `gemini:type-${type}`;
}

function windowSecondsForBucketType(type: number): number | null {
  if (type === 1) {
    return 5 * 60 * 60;
  }
  if (type === 2) {
    return 7 * 24 * 60 * 60;
  }
  return null;
}

function findWrbPayloadString(value: unknown): string | null {
  if (Array.isArray(value)) {
    if (
      value[0] === "wrb.fr" &&
      value[1] === GEMINI_USAGE_RPC_ID &&
      typeof value[2] === "string"
    ) {
      return value[2];
    }
    for (const item of value) {
      const found = findWrbPayloadString(item);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function findGeminiErrorStatus(value: unknown): number | null {
  if (Array.isArray(value)) {
    if (value[0] === "er") {
      return asNumber(value[5]);
    }
    for (const item of value) {
      const found = findGeminiErrorStatus(item);
      if (found !== null) {
        return found;
      }
    }
  }
  return null;
}

function responseFailure(response: BridgeResponse): string {
  return formatUsageError(
    usageErrorFromBridge(response),
    response.endpointKey ?? "gemini"
  );
}
