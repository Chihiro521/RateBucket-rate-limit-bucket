import { BridgeClient } from "./bridgeClient";
import { probeCodexAnalyticsUsage } from "./codexProbe";
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
import { debugLog } from "../utils/logger";

const platform = detectPlatform(window.location);

if (platform) {
  void start(platform);
}

async function start(platformId: PlatformId): Promise<void> {
  let widget!: UsageWidget;
  const bridge = new BridgeClient();
  let currentSnapshot: UsageSnapshot | null = null;
  let refreshing = false;
  let ipRiskRefreshing = false;
  let pendingEstimatorRefresh = 0;
  let codexProbeStarted = false;
  let stopCodexProbe: (() => void) | null = null;

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
      }
    }
  );

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
