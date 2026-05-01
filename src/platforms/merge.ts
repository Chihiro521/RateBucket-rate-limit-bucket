import type { UsageMeter, UsageSnapshot } from "./types";

export const MERGED_METER_TTL_MS = 30 * 60_000;

export function mergeUsageSnapshots(
  existing: UsageSnapshot | null,
  incoming: UsageSnapshot,
  now = Date.now()
): UsageSnapshot {
  const normalizedIncoming = withObservedAt(incoming, incoming.updatedAt);
  if (!existing || existing.platform !== incoming.platform) {
    return {
      ...normalizedIncoming,
      cacheAgeMs: Math.max(0, now - normalizedIncoming.updatedAt)
    };
  }

  const normalizedExisting = withObservedAt(existing, existing.updatedAt);
  const incomingKeys = new Set(normalizedIncoming.meters.map((meter) => meter.key));
  const retainedExisting = normalizedExisting.meters.filter((meter) => {
    if (incomingKeys.has(meter.key)) {
      return false;
    }
    const observedAt = meter.observedAt ?? normalizedExisting.updatedAt;
    return now - observedAt <= MERGED_METER_TTL_MS;
  });

  const meters = [...retainedExisting, ...normalizedIncoming.meters];
  const updatedAt = Math.max(normalizedExisting.updatedAt, normalizedIncoming.updatedAt);

  return {
    platform: incoming.platform,
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

function withObservedAt(
  snapshot: UsageSnapshot,
  fallbackObservedAt: number
): UsageSnapshot {
  return {
    ...snapshot,
    meters: snapshot.meters.map((meter) => ({
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
