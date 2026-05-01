import { BridgeClient } from "./bridgeClient";
import { probeCodexAnalyticsUsage } from "./codexProbe";
import { getEstimateSnapshot, installSendEstimator } from "./estimator";
import { UsageWidget } from "./widget";
import { detectPlatform } from "../platforms/detect";
import { fetchPlatformUsage } from "../platforms";
import { normalizeInterceptedUsage } from "../platforms/intercepted";
import { mergeUsageSnapshots } from "../platforms/merge";
import type { PlatformId, UsageSnapshot } from "../platforms/types";
import {
  CACHE_TTL_MS,
  FAILED_BACKOFF_STEPS_MS,
  MIN_REFRESH_INTERVAL_MS,
  getBackoffUntil,
  getCachedSnapshot,
  getFailureCount,
  getLastRefreshAt,
  setBackoffUntil,
  setCachedSnapshot,
  setFailureCount,
  setLastRefreshAt
} from "../storage/cache";
import { debugLog } from "../utils/logger";

const platform = detectPlatform(window.location);

if (platform) {
  void start(platform);
}

async function start(platformId: PlatformId): Promise<void> {
  const widget = new UsageWidget(platformId, () => {
    void refreshUsage({ force: true });
  });
  const bridge = new BridgeClient();
  let currentSnapshot: UsageSnapshot | null = null;
  let refreshing = false;
  let pendingEstimatorRefresh = 0;
  let codexProbeStarted = false;
  let stopCodexProbe: (() => void) | null = null;

  const maybeStartCodexProbe = (snapshot: UsageSnapshot): void => {
    if (
      platformId !== "chatgpt" ||
      codexProbeStarted ||
      hasCodexMeter(snapshot)
    ) {
      return;
    }
    codexProbeStarted = true;
    stopCodexProbe = probeCodexAnalyticsUsage();
  };

  const applySnapshot = async (snapshot: UsageSnapshot): Promise<void> => {
    const shouldReplace =
      platformId === "grok" && snapshot.source === "intercepted";
    currentSnapshot = mergeUsageSnapshots(
      shouldReplace ? null : currentSnapshot,
      snapshot
    );
    widget.setSnapshot(currentSnapshot);
    await setCachedSnapshot(currentSnapshot);
  };

  const refreshUsage = async (options: { force: boolean }): Promise<void> => {
    if (refreshing) {
      return;
    }

    const now = Date.now();
    const backoffUntil = await getBackoffUntil(platformId);
    widget.setBackoffUntil(backoffUntil);
    if (backoffUntil > now) {
      return;
    }

    const cached = await getCachedSnapshot(platformId);
    if (!options.force && cached && now - cached.updatedAt < CACHE_TTL_MS) {
      currentSnapshot = cached;
      widget.setSnapshot(cached);
      return;
    }

    const lastRefreshAt = await getLastRefreshAt(platformId);
    if (lastRefreshAt > 0 && now - lastRefreshAt < MIN_REFRESH_INTERVAL_MS) {
      if (cached) {
        currentSnapshot = cached;
        widget.setSnapshot(cached);
      }
      return;
    }

    refreshing = true;
    widget.setLoading(true);
    await setLastRefreshAt(platformId, now);

    try {
      let snapshot = await fetchPlatformUsage(platformId, (endpointKey, payload) =>
        bridge.fetchUsage(platformId, endpointKey, payload)
      );
      snapshot = await withEstimateFallback(platformId, snapshot);
      await applySnapshot(snapshot);
      maybeStartCodexProbe(snapshot);
      await updateFailureState(platformId, snapshot, widget);
    } catch (error) {
      const snapshot = await withEstimateFallback(platformId, {
        platform: platformId,
        meters: [],
        source: "unknown",
        updatedAt: Date.now(),
        status: "error",
        errorMessage:
          error instanceof Error ? error.message : "Unknown usage refresh error"
      });
      await applySnapshot(snapshot);
      await updateFailureState(platformId, snapshot, widget);
    } finally {
      refreshing = false;
      widget.setLoading(false);
    }
  };

  widget.mount();

  const cached = await getCachedSnapshot(platformId);
  if (cached) {
    currentSnapshot = cached;
    widget.setSnapshot(cached);
  }
  widget.setBackoffUntil(await getBackoffUntil(platformId));

  bridge.onIntercepted((message) => {
    if (message.platform !== platformId) {
      return;
    }
    const snapshot = normalizeInterceptedUsage({
      platform: platformId,
      url: message.url,
      json: message.json,
      ts: message.ts,
      endpointKey: message.endpointKey,
      usageContext: message.usageContext
    });
    if (snapshot.meters.length === 0) {
      return;
    }
    if (hasCodexMeter(snapshot)) {
      stopCodexProbe?.();
      stopCodexProbe = null;
    }
    void applySnapshot(snapshot).catch((error: unknown) => {
      debugLog("failed to cache intercepted usage", error);
    });
  });

  installSendEstimator(platformId, (snapshot) => {
    if (!currentSnapshot || currentSnapshot.meters.length === 0) {
      currentSnapshot = snapshot;
      widget.setSnapshot(snapshot);
    }
    window.clearTimeout(pendingEstimatorRefresh);
    pendingEstimatorRefresh = window.setTimeout(() => {
      void refreshUsage({ force: false });
    }, 1_500);
  });

  try {
    await injectMainWorld();
    await bridge.enableIntercept(platformId);
  } catch (error) {
    debugLog("main world bridge injection failed", error);
  }

  await refreshUsage({ force: false });

  window.addEventListener("pagehide", () => {
    stopCodexProbe?.();
  });
}

async function injectMainWorld(): Promise<void> {
  const response = await new Promise<{ ok: boolean; error?: string }>(
    (resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "AI_USAGE_INJECT_MAIN_WORLD" },
        (value: { ok: boolean; error?: string } | undefined) => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(value ?? { ok: false, error: "No injection response" });
        }
      );
    }
  );

  if (!response.ok) {
    throw new Error(response.error ?? "Injection failed");
  }
}

async function withEstimateFallback(
  platform: PlatformId,
  snapshot: UsageSnapshot
): Promise<UsageSnapshot> {
  if (snapshot.meters.length > 0 && snapshot.status !== "error") {
    return snapshot;
  }

  const estimate = await getEstimateSnapshot(platform);
  if (!estimate) {
    return snapshot;
  }

  return {
    ...estimate,
    status: snapshot.status === "error" ? "partial" : estimate.status,
    errorMessage: snapshot.errorMessage ?? estimate.errorMessage,
    updatedAt: Math.max(snapshot.updatedAt, estimate.updatedAt)
  };
}

async function updateFailureState(
  platform: PlatformId,
  snapshot: UsageSnapshot,
  widget: UsageWidget
): Promise<void> {
  if (snapshot.status !== "error") {
    await setFailureCount(platform, 0);
    await setBackoffUntil(platform, 0);
    widget.setBackoffUntil(0);
    return;
  }

  const failures = await getFailureCount(platform);
  const nextFailures = failures + 1;
  const step =
    FAILED_BACKOFF_STEPS_MS[
      Math.min(nextFailures - 1, FAILED_BACKOFF_STEPS_MS.length - 1)
    ];
  const backoffUntil = Date.now() + step;
  await setFailureCount(platform, nextFailures);
  await setBackoffUntil(platform, backoffUntil);
  widget.setBackoffUntil(backoffUntil);
}

function hasCodexMeter(snapshot: UsageSnapshot): boolean {
  return snapshot.meters.some(
    (meter) =>
      meter.rawKind === "codex.settings.usage" ||
      meter.key.toLowerCase().includes("codex")
  );
}
