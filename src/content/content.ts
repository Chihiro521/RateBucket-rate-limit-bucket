import { BridgeClient } from "./bridgeClient";
import {
  sameUsageValues,
  startVisibleUsagePolling,
  withoutOlderMeters
} from "./usagePolling";
import { getEstimateSnapshot, installSendEstimator } from "./estimator";
import { UsageWidget } from "./widget";
import { detectPlatform } from "../platforms/detect";
import { fetchPlatformUsage } from "../platforms";
import { normalizeInterceptedUsage } from "../platforms/intercepted";
import { mergeUsageSnapshots } from "../platforms/merge";
import {
  CHATGPT_SENTINEL_EVENT,
  sanitizeSentinelObservation,
  toChatGPTSentinelState
} from "../platforms/chatgptSentinel";
import {
  IP_RISK_AUTO_REFRESH_MS,
  disabledIpRiskState,
  missingKeyIpRiskState,
  type IpRiskSettingsUpdate,
  type IpRiskState
} from "../platforms/ipRisk";
import type { EndpointKey, PlatformId, UsageSnapshot } from "../platforms/types";
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
  getChatGptSentinelState,
  rememberChatGptSentinelObservation
} from "../storage/chatgptSentinel";
import {
  IP_RISK_SETTINGS_KEY,
  IP_RISK_STATE_KEY,
  getIpRiskPublicSettings,
  getIpRiskState,
  ipRiskStateFromStorageValue,
  publicSettingsFromStorageValue,
  saveIpRiskSettings,
  setIpRiskState
} from "../storage/ipRisk";
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
const CHATGPT_UNAVAILABLE_RETRY_MS = 5 * 60_000;

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
  let ipRiskRefreshing = false;
  let pendingEstimatorRefresh = 0;
  const unavailableChatGptEndpoints = new Map<EndpointKey, number>();

  const refreshIpRisk = async (options: { force: boolean }): Promise<void> => {
    if (ipRiskRefreshing) {
      return;
    }

    const settings = await getIpRiskPublicSettings();
    widget.setIpRiskSettings(settings);

    if (!settings.enabled) {
      const state = disabledIpRiskState();
      widget.setIpRiskState(state);
      if (options.force) {
        await setIpRiskState(state);
      }
      return;
    }
    if (!settings.hasApiKey) {
      const state = missingKeyIpRiskState();
      widget.setIpRiskState(state);
      if (options.force) {
        await setIpRiskState(state);
      }
      return;
    }

    const cached = await getIpRiskState();
    if (cached) {
      widget.setIpRiskState(cached);
    }
    if (
      !options.force &&
      cached &&
      cached.status === "ok" &&
      Date.now() - cached.updatedAt < IP_RISK_AUTO_REFRESH_MS
    ) {
      return;
    }

    ipRiskRefreshing = true;
    widget.setIpRiskRefreshing(true);
    try {
      const state = await requestIpRiskRefresh();
      widget.setIpRiskState(state);
    } catch (error) {
      debugLog("proxycheck refresh failed", error);
    } finally {
      ipRiskRefreshing = false;
      widget.setIpRiskRefreshing(false);
    }
  };

  const saveIpRisk = async (update: IpRiskSettingsUpdate): Promise<void> => {
    const settings = await saveIpRiskSettings(update);
    widget.setIpRiskSettings(settings);
    await refreshIpRisk({ force: settings.enabled && settings.hasApiKey });
  };

  const saveLanguage = async (mode: LanguageMode): Promise<void> => {
    widget.setLanguageMode(await saveLanguageMode(mode));
  };

  widget = new UsageWidget(
    platformId,
    () => {
      void refreshUsage({ force: true });
    },
    {
      onIpRiskRefresh: () => {
        void refreshIpRisk({ force: true });
      },
      onIpRiskSettingsSave: (update) => {
        void saveIpRisk(update).catch((error: unknown) => {
          debugLog("failed to save IP risk settings", error);
        });
      },
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
    const acceptedSnapshot = platformId === "chatgpt"
      ? withoutOlderMeters(previous, snapshot)
      : snapshot;
    const merged = mergeUsageSnapshots(previous, acceptedSnapshot);
    if (platformId === "chatgpt" && snapshot.meters.length > 0) {
      if (snapshot.source === "api") {
        merged.status = snapshot.status;
      }
      merged.checkedAt = Date.now();
      if (sameUsageValues(previous, merged)) {
        merged.updatedAt = previous!.updatedAt;
      }
      merged.cacheAgeMs = 0;
    }
    currentSnapshot = merged;
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
      let retryableEndpointFailure = false;
      let snapshot = await fetchPlatformUsage(platformId, async (endpointKey, payload) => {
        if (
          platformId === "chatgpt" &&
          !options.force &&
          (unavailableChatGptEndpoints.get(endpointKey) ?? 0) > Date.now()
        ) {
          return {
            source: "ai-usage-floating-monitor",
            direction: "main-to-content",
            requestId: "unavailable-endpoint",
            ok: false,
            platform: platformId,
            endpointKey,
            error: { status: 401, message: "Endpoint unavailable in this session" }
          };
        }
        const response = await bridge.fetchUsage(platformId, endpointKey, payload);
        if (platformId === "chatgpt") {
          if (response.ok) {
            unavailableChatGptEndpoints.delete(endpointKey);
          } else if (
            response.error?.status === 401 ||
            response.error?.status === 403 ||
            response.error?.status === 404
          ) {
            unavailableChatGptEndpoints.set(
              endpointKey,
              Date.now() + CHATGPT_UNAVAILABLE_RETRY_MS
            );
          }
          if (
            !response.ok &&
            (response.error?.status === undefined ||
              response.error.status === 429 ||
              response.error.status >= 500)
          ) {
            retryableEndpointFailure = true;
          }
        }
        return response;
      });
      snapshot = await withEstimateFallback(platformId, snapshot);
      if (platformId === "chatgpt") {
        snapshot = {
          ...snapshot,
          updatedAt: now,
          meters: snapshot.meters.map((meter) => ({ ...meter, observedAt: now }))
        };
      }
      await applySnapshot(snapshot);
      await updateFailureState(
        platformId,
        snapshot,
        widget,
        retryableEndpointFailure
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

  const cached = await getCachedSnapshot(platformId);
  if (cached) {
    currentSnapshot = cached;
    widget.setSnapshot(cached);
  }
  widget.setBackoffUntil(await getBackoffUntil(platformId));

  const ipRiskSettings = await getIpRiskPublicSettings();
  widget.setIpRiskSettings(ipRiskSettings);
  const cachedIpRisk = await getIpRiskState();
  if (cachedIpRisk) {
    widget.setIpRiskState(cachedIpRisk);
  } else if (!ipRiskSettings.enabled) {
    widget.setIpRiskState(disabledIpRiskState());
  } else if (!ipRiskSettings.hasApiKey) {
    widget.setIpRiskState(missingKeyIpRiskState());
  }
  void refreshIpRisk({ force: false });

  if (platformId === "chatgpt") {
    const cachedSentinelState = await getChatGptSentinelState();
    if (cachedSentinelState) {
      widget.setChatGptSentinelState(cachedSentinelState);
    }
  }

  const onSentinelEvent = (event: Event): void => {
    if (platformId !== "chatgpt") {
      return;
    }
    const observation = sanitizeSentinelObservation(
      (event as CustomEvent<unknown>).detail
    );
    if (!observation) {
      return;
    }
    const state = toChatGPTSentinelState(observation);
    widget.setChatGptSentinelState(state);
    void rememberChatGptSentinelObservation(observation, state).catch(
      (error: unknown) => {
        debugLog("failed to cache sentinel observation", error);
      }
    );
  };
  window.addEventListener(CHATGPT_SENTINEL_EVENT, onSentinelEvent);

  const onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    if (areaName !== "local") {
      return;
    }
    const settingsChange = changes[IP_RISK_SETTINGS_KEY];
    if (settingsChange) {
      widget.setIpRiskSettings(
        publicSettingsFromStorageValue(settingsChange.newValue)
      );
    }
    const stateChange = changes[IP_RISK_STATE_KEY];
    if (stateChange) {
      const state = ipRiskStateFromStorageValue(stateChange.newValue);
      if (state) {
        widget.setIpRiskState(state);
      }
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
          const lastCheck = currentSnapshot?.checkedAt ?? currentSnapshot?.updatedAt ?? 0;
          if (Date.now() - lastCheck >= CACHE_TTL_MS) {
            void refreshUsage({ force: false });
          }
        }
      })
    : null;

  window.addEventListener("pagehide", () => {
    stopUsagePolling?.();
    window.removeEventListener(CHATGPT_SENTINEL_EVENT, onSentinelEvent);
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

async function requestIpRiskRefresh(): Promise<IpRiskState> {
  const response = await new Promise<{
    ok: boolean;
    error?: string;
    state?: IpRiskState;
  }>((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "AI_USAGE_IP_RISK_REFRESH" },
      (
        value:
          | { ok: boolean; error?: string; state?: IpRiskState }
          | undefined
      ) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(value ?? { ok: false, error: "No IP risk response" });
      }
    );
  });

  if (response.state) {
    return response.state;
  }
  throw new Error(response.error ?? "IP 风险检测失败");
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
