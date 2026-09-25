import type { UsageMeter, UsageSnapshot } from "../platforms/types";

// Check locally more often so the network request lands close to the 60-second TTL.
export const CHATGPT_POLL_CHECK_MS = 15_000;

type PollingOptions = {
  isVisible: () => boolean;
  onVisibilityChange: (callback: () => void) => () => void;
  setInterval: (callback: () => void, intervalMs: number) => number;
  clearInterval: (id: number) => void;
  refresh: () => void;
};

export function startVisibleUsagePolling(options: PollingOptions): () => void {
  const refreshIfVisible = (): void => {
    if (options.isVisible()) {
      options.refresh();
    }
  };
  const stopVisibilityListener = options.onVisibilityChange(refreshIfVisible);
  const intervalId = options.setInterval(refreshIfVisible, CHATGPT_POLL_CHECK_MS);
  return () => {
    options.clearInterval(intervalId);
    stopVisibilityListener();
  };
}

export function sameUsageValues(
  previous: UsageSnapshot | null,
  next: UsageSnapshot
): boolean {
  if (!previous || previous.platform !== next.platform) {
    return false;
  }
  if (
    previous.status !== next.status ||
    previous.errorMessage !== next.errorMessage ||
    previous.meters.length !== next.meters.length
  ) {
    return false;
  }
  const previousValues = new Map(
    previous.meters.map((meter) => [meter.key, meterValue(meter)])
  );
  return next.meters.every(
    (meter) => previousValues.get(meter.key) === meterValue(meter)
  );
}

export function withoutOlderMeters(
  previous: UsageSnapshot | null,
  incoming: UsageSnapshot
): UsageSnapshot {
  const newestByKey = new Map(
    previous?.meters.map((meter) => [meter.key, meter.observedAt ?? previous.updatedAt]) ?? []
  );
  return {
    ...incoming,
    meters: incoming.meters.filter(
      (meter) =>
        (meter.observedAt ?? incoming.updatedAt) >=
        (newestByKey.get(meter.key) ?? 0)
    )
  };
}

function meterValue(meter: UsageMeter): string {
  return JSON.stringify({
    label: meter.label,
    modelName: meter.modelName,
    requestKind: meter.requestKind,
    remaining: meter.remaining,
    total: meter.total,
    used: meter.used,
    usedPercent: meter.usedPercent,
    remainingPercent: meter.remainingPercent,
    resetAt: meter.resetAt,
    resetAfterSeconds: meter.resetAfterSeconds,
    windowSeconds: meter.windowSeconds,
    source: meter.source,
    confidence: meter.confidence,
    rawKind: meter.rawKind
  });
}
