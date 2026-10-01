import { ChatGptUsageController } from "./chatgptUsageController";
import { BridgeClient } from "./bridgeClient";
import {
  startVisibleUsagePolling
} from "./usagePolling";
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
import {
  LANGUAGE_SETTINGS_KEY,
  getLanguageMode,
  languageModeFromStorageValue,
  saveLanguageMode
} from "../storage/language";
import type { LanguageMode } from "../utils/i18n";
import { debugLog } from "../utils/logger";

declare global {
  interface Window {
    __AI_USAGE_FLOATING_MONITOR_CONTENT__?: boolean;
  }
}

const platform = detectPlatform(window.location);

if (
  platform &&
  shouldStartOnThisFrame(platform) &&
  !window.__AI_USAGE_FLOATING_MONITOR_CONTENT__
) {
  window.__AI_USAGE_FLOATING_MONITOR_CONTENT__ = true;
  void start(platform);
}

function shouldStartOnThisFrame(platformId: PlatformId): boolean {
  if (window.top === window) {
    return true;
  }
  if (platformId !== "perplexity") {
    return false;
  }
  return window.innerWidth >= 640 && window.innerHeight >= 480;
}

async function start(platformId: PlatformId): Promise<void> {
  let widget!: UsageWidget;
  const bridge = new BridgeClient();
  let currentSnapshot: UsageSnapshot | null = null;
  let refreshing = false;
  let chatGptController: ChatGptUsageController | undefined;
  let pendingEstimatorRefresh = 0;

  const saveLanguage = async (mode: LanguageMode): Promise<void> => {
    widget.setLanguageMode(await saveLanguageMode(mode));
  };

  widget = new UsageWidget(
    platformId,
    () => {
      void refreshUsage({ force: true });
    },
    {
      onLanguageModeSave: (mode) => {
        void saveLanguage(mode).catch((error: unknown) => {
          debugLog("failed to save language settings", error);
        });
      }
    }
  );
  widget.mount();
  widget.setLanguageMode(await getLanguageMode());

  const applySnapshot = async (snapshot: UsageSnapshot): Promise<void> => {
    const shouldReplace =
      platformId === "grok" && snapshot.source === "intercepted";
    const previous = shouldReplace ? null : currentSnapshot;
    const merged = mergeUsageSnapshots(previous, snapshot);
    currentSnapshot = merged;
    widget.setSnapshot(currentSnapshot);
    await setCachedSnapshot(currentSnapshot);
  };

  const refreshUsage = async (options: { force: boolean }): Promise<void> => {
    if (chatGptController) { await chatGptController.refresh(options.force ? "manual" : "poll"); return; }
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
    if (
      !options.force &&
      cached &&
      now - (cached.checkedAt ?? cached.updatedAt) < CACHE_TTL_MS
    ) {
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
      const snapshot = await withEstimateFallback(platformId, await fetchPlatformUsage(platformId, (key, payload) => bridge.fetchUsage(platformId, key, payload)));
      await applySnapshot(snapshot);
      await updateFailureState(
        platformId,
        snapshot,
        widget
      );
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

  if (platformId === "chatgpt") {
    chatGptController = new ChatGptUsageController({
      fetcher: (key) => bridge.fetchUsage(platformId, key),
      onSnapshot: (snapshot) => { currentSnapshot = snapshot; widget.setSnapshot(snapshot); },
      onLoading: (loading) => widget.setLoading(loading),
      readCache: (scope) => getCachedSnapshot("chatgpt", scope),
      writeCache: setCachedSnapshot
    });
    bridge.onContextChanged(() => {
      chatGptController?.reset();
      void chatGptController?.refresh("startup");
    });
  }

  const cached = await getCachedSnapshot(platformId);
  if (cached) {
    currentSnapshot = cached;
    widget.setSnapshot(cached);
  }
  widget.setBackoffUntil(platformId === "chatgpt" ? 0 : await getBackoffUntil(platformId));

  const onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    if (areaName !== "local") {
      return;
    }
    const languageChange = changes[LANGUAGE_SETTINGS_KEY];
    if (languageChange) {
      widget.setLanguageMode(
        languageModeFromStorageValue(languageChange.newValue)
      );
    }
  };
  chrome.storage.onChanged.addListener(onStorageChanged);

  bridge.onIntercepted((message) => {
    if (message.platform !== platformId) {
      return;
    }
    if (chatGptController && message.endpointKey) {
      void chatGptController.acceptIntercept(message.endpointKey, message.json, message.ts, message.requestStartedAt, message.scopeKey);
      return;
    }
    const snapshot = normalizeInterceptedUsage({
      platform: platformId,
      url: message.url,
      json: message.json,
      text: message.text,
      ts: message.ts,
      endpointKey: message.endpointKey
    });
    if (snapshot.meters.length === 0) {
      return;
    }
    void applySnapshot(snapshot).catch((error: unknown) => {
      debugLog("failed to cache intercepted usage", error);
    });
  });

  const stopEstimator = installSendEstimator(platformId, (snapshot) => {
    if (platformId !== "chatgpt" && (!currentSnapshot || currentSnapshot.meters.length === 0)) {
      currentSnapshot = snapshot;
      widget.setSnapshot(snapshot);
    }
    window.clearTimeout(pendingEstimatorRefresh);
    pendingEstimatorRefresh = window.setTimeout(() => {
      if (chatGptController) void chatGptController.refresh("operation");
      else void refreshUsage({ force: false });
    }, 1_500);
  }, { recordCounts: platformId !== "chatgpt" });

  try {
    await injectMainWorld();
    await bridge.enableIntercept(platformId);
  } catch (error) {
    debugLog("main world bridge injection failed", error);
  }

  await refreshUsage({ force: false });

  const stopUsagePolling = platformId === "chatgpt"
    ? startVisibleUsagePolling({
        isVisible: () => document.visibilityState === "visible",
        onVisibilityChange: (callback) => {
          document.addEventListener("visibilitychange", callback);
          return () => document.removeEventListener("visibilitychange", callback);
        },
        setInterval: (callback, intervalMs) => window.setInterval(callback, intervalMs),
        clearInterval: (id) => window.clearInterval(id),
        refresh: () => {
          void refreshUsage({ force: false });
        }
      })
    : null;

  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    stopEstimator();
    widget.destroy();
    stopUsagePolling?.();
    chatGptController?.destroy();
    bridge.destroy();
    window.clearTimeout(pendingEstimatorRefresh);
    chrome.storage.onChanged.removeListener(onStorageChanged);
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
  widget: UsageWidget,
  retryableEndpointFailure = false
): Promise<void> {
  if (snapshot.status !== "error" && !retryableEndpointFailure) {
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
