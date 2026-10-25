import type { UsageMeter, UsageSnapshot } from "./types";
import { isChatPassPath } from "./presentation";
import { IMAGE_GENERATION_KEY, clearImageLimit } from "./chatgptImage";
import { resolveResetMs } from "../utils/time";

export const MERGED_METER_TTL_MS = 30 * 60_000;

export function shouldRetainMeter(
  meter: UsageMeter,
  now = Date.now(),
  fallbackObservedAt = now
): boolean {
  if (meter.rawKind === "chatgpt.image_recovery") return true;
  if (meter.key === IMAGE_GENERATION_KEY && meter.quotaState === "blocked") {
    const observedAt = meter.observedAt ?? fallbackObservedAt;
    const expiresAt = resolveResetMs({ ...meter, observedAt }, now) ?? observedAt + MERGED_METER_TTL_MS;
    return now < Math.min(expiresAt, observedAt + 86_400_000);
  }
  // Subscription dates stay valid until the server sends a new entitlement.
  if (meter.metricKind === "subscription" || meter.rawKind === "chatgpt.subscription") {
    return true;
  }
  return now - (meter.observedAt ?? fallbackObservedAt) <= MERGED_METER_TTL_MS;
}

export function expireImageLimit(meter: UsageMeter, now = Date.now(), fallbackObservedAt = now): UsageMeter {
  return meter.key === IMAGE_GENERATION_KEY && meter.quotaState === "blocked" && !shouldRetainMeter(meter, now, fallbackObservedAt)
    ? { ...clearImageLimit(meter, now), rawKind: "chatgpt.image_recovery" } : meter;
}

export function mergeUsageSnapshots(
  existing: UsageSnapshot | null,
  incoming: UsageSnapshot,
  now = Date.now()
): UsageSnapshot {
  const normalizedIncoming = withObservedAt(incoming, incoming.updatedAt);
  if (!existing || existing.platform !== incoming.platform || existing.scopeKey !== incoming.scopeKey) {
    return {
      ...normalizedIncoming,
      cacheAgeMs: Math.max(0, now - normalizedIncoming.updatedAt)
    };
  }

  const normalizedExisting = withObservedAt(existing, existing.updatedAt);
  normalizedExisting.meters = normalizedExisting.meters.map((meter) => expireImageLimit(meter, now, existing.updatedAt));
  normalizedIncoming.meters = normalizedIncoming.meters.map((meter) => {
    const previous = normalizedExisting.meters.find((item) => item.key === meter.key);
    if (!previous) return meter;
    // An uncalibrated poll cannot confirm image recovery.
    if (meter.key === IMAGE_GENERATION_KEY && meter.quotaState === "unknown" &&
      (previous.quotaState === "blocked" || previous.rawKind === "chatgpt.image_recovery")) return previous;
    if ((meter.requestStartedAt ?? meter.observedAt ?? 0) <
        (previous.requestStartedAt ?? previous.observedAt ?? 0)) return previous;
    if (previous.quotaState === "blocked" && meter.quotaState === "unknown") {
      return now - (previous.observedAt ?? 0) <= MERGED_METER_TTL_MS
        ? previous : { ...meter, remaining: null };
    }
    return meter;
  });
  const incomingKeys = new Set(normalizedIncoming.meters.map((meter) => meter.key));
  const incomingHasAuthoritativeMeter = normalizedIncoming.meters.some(
    (meter) => meter.source !== "estimate"
  );
  const retainedExisting = normalizedExisting.meters.filter((meter) => {
    if (incomingKeys.has(meter.key)) {
      return false;
    }
    if (incomingHasAuthoritativeMeter && isLocalEstimateMeter(meter)) {
      return false;
    }
    return shouldRetainMeter(meter, now, normalizedExisting.updatedAt);
  });

  const meters = [...retainedExisting, ...normalizedIncoming.meters];
  const updatedAt = Math.max(normalizedExisting.updatedAt, normalizedIncoming.updatedAt);

  return {
    platform: incoming.platform,
    scopeKey: incoming.scopeKey,
    checkedAt: incoming.checkedAt ?? existing.checkedAt,
    meters,
    source: normalizedIncoming.source,
    updatedAt,
    cacheAgeMs: Math.max(0, now - updatedAt),
    status: mergedStatus(normalizedExisting, normalizedIncoming, meters.length),
    errorMessage: mergedErrorMessage(normalizedExisting, normalizedIncoming, meters.length),
    debug: {
      endpoint: joinDebugField(
        normalizedExisting.debug?.endpoint,
        normalizedIncoming.debug?.endpoint
      ),
      parser: joinDebugField(
        normalizedExisting.debug?.parser,
        normalizedIncoming.debug?.parser
      )
    }
  };
}

function isLocalEstimateMeter(meter: UsageMeter): boolean {
  return meter.rawKind === "localEstimate" || meter.key === "local:sent-count";
}

function withObservedAt(
  snapshot: UsageSnapshot,
  fallbackObservedAt: number
): UsageSnapshot {
  return {
    ...snapshot,
    meters: snapshot.meters.filter((meter) =>
      snapshot.platform !== "chatgpt" || !isChatPassPath(meter.key)).map((meter) => ({
      ...meter,
      observedAt: meter.observedAt ?? fallbackObservedAt
    }))
  };
}

function mergedStatus(
  existing: UsageSnapshot,
  incoming: UsageSnapshot,
  meterCount: number
): UsageSnapshot["status"] {
  if (meterCount === 0) {
    return incoming.status !== "unknown" ? incoming.status : existing.status;
  }
  if (incoming.status === "error") {
    return "partial";
  }
  if (incoming.status === "partial" || existing.status === "partial") {
    return "partial";
  }
  return "ok";
}

function mergedErrorMessage(
  existing: UsageSnapshot,
  incoming: UsageSnapshot,
  meterCount: number
): string | undefined {
  if (meterCount === 0) {
    return incoming.errorMessage ?? existing.errorMessage;
  }
  if (incoming.errorMessage === "部分功能被限制") {
    return incoming.errorMessage;
  }
  return undefined;
}

function joinDebugField(
  existing: string | undefined,
  incoming: string | undefined
): string | undefined {
  const values = [existing, incoming].filter((value): value is string =>
    Boolean(value)
  );
  if (values.length === 0) {
    return undefined;
  }
  return Array.from(new Set(values.flatMap((value) => value.split(",")))).join(",");
}
