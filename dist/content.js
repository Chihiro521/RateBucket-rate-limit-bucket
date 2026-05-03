(function() {
  "use strict";
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function asRecord(value) {
    return isRecord(value) ? value : null;
  }
  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }
  function asString(value) {
    return typeof value === "string" ? value : null;
  }
  function asNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
  function asBoolean(value) {
    return typeof value === "boolean" ? value : null;
  }
  function getRecord(record, key) {
    return asRecord(record[key]);
  }
  function getArray(record, key) {
    return asArray(record[key]);
  }
  function getNumber(record, key) {
    return asNumber(record[key]);
  }
  function getString(record, key) {
    return asString(record[key]);
  }
  function percentFromRatioOrPercent(value) {
    if (value === null) {
      return null;
    }
    const percent = value >= 0 && value <= 1 ? value * 100 : value;
    return Math.max(0, Math.min(100, percent));
  }
  function titleFromKey(key) {
    return key.replace(/[_-]+/g, " ").trim().replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1));
  }
  const SOURCE = "ai-usage-floating-monitor";
  function isBridgeResponse(value) {
    return isRecord(value) && value.source === SOURCE && value.direction === "main-to-content" && typeof value.requestId === "string" && typeof value.ok === "boolean" && typeof value.platform === "string" && !("kind" in value);
  }
  function isInterceptedUsageMessage(value) {
    return isRecord(value) && value.source === SOURCE && value.direction === "main-to-content" && value.kind === "interceptedUsage" && typeof value.platform === "string" && typeof value.url === "string" && typeof value.ts === "number";
  }
  class BridgeClient {
    pending = /* @__PURE__ */ new Map();
    interceptHandlers = /* @__PURE__ */ new Set();
    onMessage = (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (isInterceptedUsageMessage(event.data)) {
        for (const handler of this.interceptHandlers) {
          handler(event.data);
        }
        return;
      }
      if (event.source !== window) {
        return;
      }
      if (!isBridgeResponse(event.data)) {
        return;
      }
      const pending = this.pending.get(event.data.requestId);
      if (!pending) {
        return;
      }
      window.clearTimeout(pending.timeoutId);
      this.pending.delete(event.data.requestId);
      pending.resolve(event.data);
    };
    constructor() {
      window.addEventListener("message", this.onMessage);
    }
    destroy() {
      window.removeEventListener("message", this.onMessage);
      for (const pending of this.pending.values()) {
        window.clearTimeout(pending.timeoutId);
      }
      this.pending.clear();
      this.interceptHandlers.clear();
    }
    onIntercepted(handler) {
      this.interceptHandlers.add(handler);
      return () => this.interceptHandlers.delete(handler);
    }
    fetchUsage(platform2, endpointKey, payload) {
      return this.send(platform2, "fetchUsage", endpointKey, payload);
    }
    enableIntercept(platform2) {
      return this.send(platform2, "enableIntercept");
    }
    send(platform2, action, endpointKey, payload) {
      const requestId = makeRequestId();
      return new Promise((resolve) => {
        const timeoutId = window.setTimeout(() => {
          this.pending.delete(requestId);
          resolve({
            source: SOURCE,
            direction: "main-to-content",
            requestId,
            ok: false,
            platform: platform2,
            endpointKey,
            error: {
              message: "Bridge request timed out"
            }
          });
        }, 12e3);
        this.pending.set(requestId, {
          resolve,
          timeoutId,
          platform: platform2,
          endpointKey
        });
        window.postMessage(
          {
            source: SOURCE,
            direction: "content-to-main",
            requestId,
            action,
            platform: platform2,
            endpointKey,
            payload
          },
          window.location.origin
        );
      });
    }
  }
  function makeRequestId() {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  const CODEX_ANALYTICS_URL = "https://chatgpt.com/codex/cloud/settings/analytics#usage";
  function probeCodexAnalyticsUsage() {
    const iframe = document.createElement("iframe");
    iframe.src = CODEX_ANALYTICS_URL;
    iframe.title = "Codex usage probe";
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.width = "1px";
    iframe.style.height = "1px";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";
    iframe.style.border = "0";
    iframe.style.left = "-9999px";
    iframe.style.top = "-9999px";
    document.documentElement.append(iframe);
    const timeoutId = window.setTimeout(() => {
      iframe.remove();
    }, 15e3);
    return () => {
      window.clearTimeout(timeoutId);
      iframe.remove();
    };
  }
  const CACHE_TTL_MS = 6e4;
  const MIN_REFRESH_INTERVAL_MS = 3e4;
  const FAILED_BACKOFF_STEPS_MS = [6e4, 12e4, 3e5];
  function snapshotKey(platform2) {
    return `aiUsage:${platform2}:snapshot`;
  }
  function lastRefreshKey(platform2) {
    return `aiUsage:${platform2}:lastRefreshAt`;
  }
  function backoffKey(platform2) {
    return `aiUsage:${platform2}:backoffUntil`;
  }
  function failureCountKey(platform2) {
    return `aiUsage:${platform2}:failureCount`;
  }
  function estimateKey(platform2) {
    return `aiUsage:${platform2}:estimate`;
  }
  function storageGet$2(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (items) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(items);
      });
    });
  }
  function storageSet$2(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(items, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
  }
  async function getCachedSnapshot(platform2) {
    const key = snapshotKey(platform2);
    const items = await storageGet$2(key);
    const value = items[key];
    if (!isUsageSnapshot(value, platform2)) {
      return null;
    }
    return {
      ...value,
      cacheAgeMs: Math.max(0, Date.now() - value.updatedAt)
    };
  }
  function setCachedSnapshot(snapshot) {
    const { cacheAgeMs: _cacheAgeMs, ...persisted } = snapshot;
    return storageSet$2({ [snapshotKey(snapshot.platform)]: persisted });
  }
  async function getLastRefreshAt(platform2) {
    const key = lastRefreshKey(platform2);
    const items = await storageGet$2(key);
    return typeof items[key] === "number" ? items[key] : 0;
  }
  function setLastRefreshAt(platform2, value) {
    return storageSet$2({ [lastRefreshKey(platform2)]: value });
  }
  async function getBackoffUntil(platform2) {
    const key = backoffKey(platform2);
    const items = await storageGet$2(key);
    return typeof items[key] === "number" ? items[key] : 0;
  }
  function setBackoffUntil(platform2, value) {
    return storageSet$2({ [backoffKey(platform2)]: value });
  }
  async function getFailureCount(platform2) {
    const key = failureCountKey(platform2);
    const items = await storageGet$2(key);
    return typeof items[key] === "number" ? items[key] : 0;
  }
  function setFailureCount(platform2, value) {
    return storageSet$2({ [failureCountKey(platform2)]: value });
  }
  async function getEstimateState(platform2) {
    const key = estimateKey(platform2);
    const items = await storageGet$2(key);
    const value = items[key];
    if (!isEstimateState(value)) {
      return null;
    }
    return value;
  }
  async function incrementEstimateState(platform2) {
    const existing = await getEstimateState(platform2);
    const now = Date.now();
    const next = {
      sentCount: (existing?.sentCount ?? 0) + 1,
      firstSentAt: existing?.firstSentAt ?? now,
      lastSentAt: now
    };
    await storageSet$2({ [estimateKey(platform2)]: next });
    return next;
  }
  function isUsageSnapshot(value, platform2) {
    return typeof value === "object" && value !== null && value.platform === platform2 && Array.isArray(value.meters) && typeof value.updatedAt === "number";
  }
  function isEstimateState(value) {
    return typeof value === "object" && value !== null && typeof value.sentCount === "number" && typeof value.firstSentAt === "number" && typeof value.lastSentAt === "number";
  }
  function installSendEstimator(platform2, onEstimate) {
    let lastIncrementAt = 0;
    const increment = () => {
      const now = Date.now();
      if (now - lastIncrementAt < 1200) {
        return;
      }
      lastIncrementAt = now;
      void incrementEstimateState(platform2).then((state) => {
        onEstimate(snapshotFromEstimate(platform2, state));
      });
    };
    const onClick = (event) => {
      if (isLikelySendButton(event.target)) {
        increment();
      }
    };
    const onSubmit = () => {
      increment();
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }
  async function getEstimateSnapshot(platform2) {
    const state = await getEstimateState(platform2);
    if (!state || state.sentCount <= 0) {
      return null;
    }
    return snapshotFromEstimate(platform2, state);
  }
  function snapshotFromEstimate(platform2, state) {
    return {
      platform: platform2,
      meters: [
        {
          key: "local:sent-count",
          label: "Sent locally",
          used: state.sentCount,
          source: "estimate",
          confidence: "low",
          rawKind: "localEstimate"
        }
      ],
      source: "estimate",
      updatedAt: state.lastSentAt,
      status: "unknown",
      errorMessage: "Using local estimate only"
    };
  }
  function isLikelySendButton(target) {
    if (!(target instanceof Element)) {
      return false;
    }
    const button = target.closest("button,[role='button']");
    if (!button) {
      return false;
    }
    const label = [
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
      button.getAttribute("data-testid"),
      button.textContent
    ].filter((value) => Boolean(value)).join(" ").toLowerCase();
    return /\bsend\b|发送|submit|composer-submit|send-button/.test(label);
  }
  function formatAge(timestamp, now = Date.now()) {
    const seconds = Math.max(0, Math.floor((now - timestamp) / 1e3));
    if (seconds < 5) {
      return "刚刚";
    }
    if (seconds < 60) {
      return `${seconds}秒前`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes}分钟前`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours}小时前`;
    }
    return `${Math.floor(hours / 24)}天前`;
  }
  function resolveResetMs(meter, now = Date.now()) {
    if (typeof meter.resetAfterSeconds === "number") {
      return now + meter.resetAfterSeconds * 1e3;
    }
    if (typeof meter.resetAt === "number") {
      if (meter.resetAt > 1e10) {
        return meter.resetAt;
      }
      if (meter.resetAt > 1e9) {
        return meter.resetAt * 1e3;
      }
      if (meter.resetAt > 0) {
        return now + meter.resetAt * 1e3;
      }
    }
    if (typeof meter.resetAt === "string") {
      const parsed = Date.parse(meter.resetAt);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
  function formatReset(meter, now = Date.now()) {
    const resetMs = resolveResetMs(meter, now);
    if (resetMs === null) {
      return "";
    }
    const seconds = Math.max(0, Math.floor((resetMs - now) / 1e3));
    if (seconds < 60) {
      return `${seconds}秒`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes}分钟`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 48) {
      return `${hours}小时`;
    }
    return `${Math.floor(hours / 24)}天`;
  }
  const WIDGET_CSS = `
:host {
  color-scheme: light dark;
  position: fixed;
  top: 50%;
  right: 12px;
  transform: translateY(-50%);
  z-index: 2147483000;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.35;
}

:host([data-platform="chatgpt"]) {
  top: clamp(12px, 4vh, 28px);
  right: clamp(10px, 2vw, 24px);
  transform: none;
}

* {
  box-sizing: border-box;
}

button {
  font: inherit;
}

.collapsed {
  min-width: 72px;
  height: 40px;
  border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, Canvas 92%, CanvasText 8%);
  color: CanvasText;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  display: grid;
  grid-template-columns: 8px 1fr;
  gap: 8px;
  align-items: center;
  padding: 6px 10px;
  cursor: pointer;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.gpt-restore-chip {
  min-width: 88px;
  min-height: 48px;
  border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, Canvas 94%, CanvasText 6%);
  color: CanvasText;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  display: grid;
  grid-template-columns: 8px 1fr;
  gap: 9px;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #9ca3af;
}

.status-ok {
  background: #10b981;
}

.status-partial {
  background: #f59e0b;
}

.status-error {
  background: #ef4444;
}

.collapsed-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.platform {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0;
}

.primary {
  font-size: 13px;
  font-weight: 650;
  white-space: nowrap;
}

.panel {
  width: min(320px, calc(100vw - 28px));
  border: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, Canvas 96%, CanvasText 4%);
  color: CanvasText;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}

.gpt-panel {
  width: min(400px, calc(100vw - 20px));
  height: min(560px, calc(100vh - 24px));
  min-height: 320px;
  border: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, Canvas 96%, CanvasText 4%);
  color: CanvasText;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.22);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.gpt-collapsed-panel {
  width: min(400px, calc(100vw - 20px));
  min-height: 48px;
  border: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, Canvas 96%, CanvasText 4%);
  color: CanvasText;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.22);
  display: grid;
  grid-template-columns: minmax(88px, 1fr) minmax(84px, auto) auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 10px 8px;
  border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
}

.gpt-header {
  flex: 0 0 auto;
  min-height: 58px;
}

.gpt-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.gpt-alerts {
  color: color-mix(in srgb, CanvasText 66%, transparent);
  font-size: 12px;
  white-space: nowrap;
}

.title {
  font-size: 14px;
  font-weight: 750;
}

.gpt-title {
  font-size: 18px;
  font-weight: 780;
  letter-spacing: 0;
  min-width: 0;
  white-space: nowrap;
}

.gpt-collapsed-summary {
  min-width: 0;
  color: color-mix(in srgb, CanvasText 76%, transparent);
  font-size: 13px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}

.actions {
  display: flex;
  gap: 6px;
}

.gpt-actions {
  flex: 0 0 auto;
}

.icon-button {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
  background: color-mix(in srgb, Canvas 90%, CanvasText 10%);
  color: CanvasText;
  cursor: pointer;
  display: grid;
  place-items: center;
}

.icon-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.meta {
  padding: 8px 10px;
  color: color-mix(in srgb, CanvasText 70%, transparent);
  font-size: 12px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.gpt-panel > .meta {
  flex: 0 0 auto;
  border-bottom: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
  padding: 9px 12px;
}

.model-meta {
  padding: 7px 10px 8px;
  border-top: 1px solid color-mix(in srgb, CanvasText 8%, transparent);
  border-bottom: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
  color: color-mix(in srgb, CanvasText 70%, transparent);
  font-size: 11px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}

.model-label {
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0;
}

.model-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}

.content {
  padding: 4px 10px 10px;
}

.gpt-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 12px 12px;
  scrollbar-width: none;
  scrollbar-color: transparent transparent;
}

.gpt-content:hover,
.gpt-content:focus-within {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, CanvasText 26%, transparent) transparent;
}

.gpt-content::-webkit-scrollbar {
  width: 0;
}

.gpt-content:hover::-webkit-scrollbar,
.gpt-content:focus-within::-webkit-scrollbar {
  width: 6px;
}

.gpt-content::-webkit-scrollbar-track {
  background: transparent;
}

.gpt-content::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, CanvasText 24%, transparent);
  border-radius: 999px;
}

.meter {
  padding: 8px 0;
  border-top: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
}

.gpt-content .meter {
  padding: 11px 0;
}

.meter-section {
  border-top: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
  padding: 8px 0 2px;
}

.meter-section:first-child {
  border-top: 0;
}

.meter-section-title {
  color: color-mix(in srgb, CanvasText 58%, transparent);
  font-size: 11px;
  font-weight: 760;
  letter-spacing: 0;
  padding: 3px 0 2px;
}

.meter-section .meter:first-of-type {
  border-top: 0;
}

.meter:first-child {
  border-top: 0;
}

.meter-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: baseline;
}

.meter-label {
  font-weight: 650;
  min-width: 0;
}

.meter-value {
  color: color-mix(in srgb, CanvasText 82%, transparent);
  white-space: nowrap;
}

.bar {
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, CanvasText 12%, transparent);
  overflow: hidden;
  margin-top: 7px;
}

.bar-fill {
  height: 100%;
  width: 0%;
  border-radius: inherit;
  background: #2563eb;
}

.bar-fill.remaining-fill {
  background: #22c55e;
}

.sentinel-block {
  padding: 7px 0 4px;
}

.sentinel-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: baseline;
  color: color-mix(in srgb, CanvasText 78%, transparent);
  font-size: 12px;
  padding: 2px 0;
}

.sentinel-label {
  color: color-mix(in srgb, CanvasText 60%, transparent);
  font-weight: 650;
}

.sentinel-bar {
  margin: 6px 0 7px;
}

.sentinel-risk-normal {
  background: #22c55e;
}

.sentinel-risk-elevated {
  background: #f59e0b;
}

.sentinel-risk-high {
  background: #f97316;
}

.sentinel-risk-severe {
  background: #ef4444;
}

.sentinel-explanation {
  margin-top: 5px;
  color: color-mix(in srgb, CanvasText 64%, transparent);
  font-size: 11px;
  line-height: 1.4;
}

.error-text {
  color: #ef4444;
}

.settings-popover {
  position: fixed;
  top: clamp(12px, 5vh, 40px);
  right: clamp(10px, 2vw, 24px);
  width: min(360px, calc(100vw - 20px));
  border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, Canvas 98%, CanvasText 2%);
  color: CanvasText;
  box-shadow: 0 18px 54px rgba(0, 0, 0, 0.26);
  padding: 12px;
  z-index: 2147483001;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.settings-title {
  font-size: 14px;
  font-weight: 760;
}

.settings-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 650;
  margin: 4px 0 12px;
}

.settings-label {
  display: block;
  color: color-mix(in srgb, CanvasText 66%, transparent);
  font-size: 11px;
  font-weight: 650;
  margin-bottom: 5px;
}

.settings-input {
  width: 100%;
  height: 34px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  background: color-mix(in srgb, Canvas 96%, CanvasText 4%);
  color: CanvasText;
  padding: 6px 8px;
  outline: none;
}

.settings-input-wrap {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  align-items: center;
  border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, Canvas 96%, CanvasText 4%);
  overflow: hidden;
}

.settings-input-wrap .settings-input {
  border: 0;
  border-radius: 0;
  background: transparent;
}

.settings-eye-button {
  width: 34px;
  height: 34px;
  border: 0;
  border-left: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.settings-input:focus {
  border-color: #2563eb;
}

.settings-input-wrap:focus-within {
  border-color: #2563eb;
}

.settings-help {
  margin-top: 8px;
  color: color-mix(in srgb, CanvasText 62%, transparent);
  font-size: 11px;
  line-height: 1.45;
}

.settings-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.settings-button {
  min-height: 30px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
  background: color-mix(in srgb, Canvas 90%, CanvasText 10%);
  color: CanvasText;
  cursor: pointer;
  padding: 5px 10px;
}

.settings-button:disabled {
  opacity: 0.52;
  cursor: not-allowed;
}

.primary-button {
  border-color: color-mix(in srgb, #2563eb 65%, CanvasText 10%);
  background: #2563eb;
  color: white;
}

.danger-button {
  color: #ef4444;
}

.meter-bottom {
  margin-top: 6px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  color: color-mix(in srgb, CanvasText 66%, transparent);
  font-size: 11px;
}

.badge {
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, CanvasText 13%, transparent);
  padding: 1px 6px;
  background: color-mix(in srgb, Canvas 88%, CanvasText 12%);
}

.empty,
.error {
  padding: 12px 0;
  color: color-mix(in srgb, CanvasText 72%, transparent);
}

.error {
  color: #ef4444;
}

/* Botanical ivory theme, inspired by a green fantasy dashboard without copying source art. */
:host {
  color-scheme: light;
  --aiqm-paper: #fffdf3;
  --aiqm-paper-soft: #f8f3dc;
  --aiqm-paper-warm: #fff8df;
  --aiqm-ink: #31461f;
  --aiqm-muted: #7b7a64;
  --aiqm-leaf: #6f9c37;
  --aiqm-leaf-dark: #3c661d;
  --aiqm-leaf-soft: #dbeaba;
  --aiqm-gold: #c8a94f;
  --aiqm-gold-soft: #efe2a7;
  --aiqm-line: rgba(139, 157, 79, 0.34);
  --aiqm-shadow: 0 18px 42px rgba(56, 71, 36, 0.24);
  --aiqm-glow: 0 0 18px rgba(157, 206, 89, 0.18);
  color: var(--aiqm-ink);
}

.panel,
.gpt-panel,
.gpt-collapsed-panel,
.settings-popover {
  border: 1px solid rgba(151, 132, 62, 0.58);
  background:
    radial-gradient(circle at 18% 0%, rgba(205, 234, 148, 0.24), transparent 34%),
    radial-gradient(circle at 100% 16%, rgba(235, 210, 112, 0.18), transparent 28%),
    linear-gradient(135deg, rgba(255, 255, 248, 0.96), rgba(252, 247, 224, 0.96)),
    repeating-linear-gradient(45deg, rgba(126, 154, 58, 0.045) 0 1px, transparent 1px 12px);
  color: var(--aiqm-ink);
  box-shadow: var(--aiqm-shadow), var(--aiqm-glow), inset 0 0 0 1px rgba(255, 255, 255, 0.78);
}

.gpt-panel::before,
.panel::before,
.gpt-collapsed-panel::before,
.settings-popover::before {
  content: "";
  display: block;
  height: 4px;
  background: linear-gradient(90deg, transparent, var(--aiqm-leaf-soft), var(--aiqm-gold-soft), var(--aiqm-leaf-soft), transparent);
}

.gpt-panel::before,
.panel::before {
  flex: 0 0 auto;
}

.gpt-collapsed-panel::before {
  display: none;
}

.collapsed,
.gpt-restore-chip {
  border: 1px solid rgba(151, 132, 62, 0.54);
  background: linear-gradient(145deg, #fffdf4, #f1f7df);
  color: var(--aiqm-ink);
  box-shadow: 0 12px 30px rgba(54, 74, 34, 0.22);
}

.collapsed:hover,
.gpt-restore-chip:hover {
  border-color: rgba(111, 156, 55, 0.7);
  background: linear-gradient(145deg, #fffffa, #e8f4cf);
}

.status-dot {
  background: #9ca67f;
  box-shadow: 0 0 0 2px rgba(255, 250, 224, 0.9);
}

.status-ok {
  background: #70a742;
}

.status-partial {
  background: #c99a2c;
}

.status-error {
  background: #d65a3f;
}

.header {
  background:
    linear-gradient(180deg, rgba(255, 253, 243, 0.98), rgba(246, 242, 217, 0.92)),
    linear-gradient(90deg, rgba(118, 154, 60, 0.08), transparent 35%, rgba(200, 169, 79, 0.12));
  border-bottom: 1px solid var(--aiqm-line);
  position: relative;
}

.header::after {
  content: "";
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: -1px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(111, 156, 55, 0.58), rgba(200, 169, 79, 0.62), transparent);
}

.title,
.gpt-title,
.settings-title {
  color: var(--aiqm-leaf-dark);
  font-family: Georgia, "Times New Roman", ui-serif, serif;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.9);
}

.title::before,
.gpt-title::before,
.settings-title::before {
  content: "✥";
  color: var(--aiqm-leaf);
  margin-right: 7px;
  font-family: Georgia, "Times New Roman", ui-serif, serif;
}

.gpt-alerts,
.gpt-collapsed-summary,
.meta,
.model-meta,
.sentinel-row,
.meter-bottom,
.settings-help {
  color: var(--aiqm-muted);
}

.gpt-alerts {
  border: 1px solid rgba(151, 132, 62, 0.28);
  border-radius: 999px;
  background: rgba(255, 252, 234, 0.72);
  padding: 4px 8px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.54);
}

.icon-button,
.settings-button {
  border: 1px solid rgba(151, 132, 62, 0.45);
  background: linear-gradient(145deg, #fffdf5, #eff6dc);
  color: var(--aiqm-leaf-dark);
  box-shadow: 0 2px 8px rgba(70, 87, 45, 0.14), inset 0 0 0 1px rgba(255, 255, 255, 0.62);
}

.icon-button:hover,
.settings-button:hover {
  border-color: rgba(111, 156, 55, 0.72);
  background: linear-gradient(145deg, #fffef8, #e9f3cf);
  transform: translateY(-1px);
}

.icon-button:active,
.settings-button:active {
  transform: translateY(0);
  box-shadow: inset 0 2px 5px rgba(54, 74, 34, 0.16);
}

.icon-button:disabled,
.settings-button:disabled {
  color: rgba(49, 70, 31, 0.46);
  box-shadow: none;
}

.primary-button {
  border-color: rgba(92, 126, 38, 0.74);
  background: linear-gradient(145deg, #83b747, #4f8127);
  color: #fffdf3;
}

.danger-button {
  color: #c94432;
}

.gpt-panel > .meta,
.model-meta {
  border-color: var(--aiqm-line);
  background: rgba(255, 252, 234, 0.62);
}

.gpt-content {
  background:
    radial-gradient(circle at 50% 0%, rgba(230, 243, 190, 0.26), transparent 36%),
    linear-gradient(180deg, rgba(255, 253, 243, 0.78), rgba(251, 246, 224, 0.78)),
    repeating-linear-gradient(90deg, transparent 0 28px, rgba(111, 156, 55, 0.035) 28px 29px);
}

.gpt-content::-webkit-scrollbar-thumb {
  background: rgba(95, 122, 54, 0.32);
}

.meter-section {
  border: 1px solid rgba(151, 132, 62, 0.28);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 254, 248, 0.86), rgba(251, 247, 224, 0.74)),
    radial-gradient(circle at 100% 0%, rgba(204, 229, 145, 0.16), transparent 30%);
  margin-top: 10px;
  padding: 9px 12px 8px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.62);
  position: relative;
}

.meter-section::after {
  content: "";
  position: absolute;
  left: 50%;
  top: -5px;
  width: 18px;
  height: 9px;
  border: 1px solid rgba(151, 132, 62, 0.28);
  border-bottom: 0;
  border-radius: 14px 14px 0 0;
  background: linear-gradient(180deg, #fffdf4, #edf5d6);
  transform: translateX(-50%);
}

.meter-section:first-child {
  border-top: 1px solid rgba(151, 132, 62, 0.28);
}

.meter-section-title {
  color: var(--aiqm-leaf-dark);
  font-size: 13px;
  font-family: Georgia, "Times New Roman", ui-serif, serif;
  display: flex;
  align-items: center;
  gap: 5px;
}

.meter-section-title::before {
  content: "✦";
  color: var(--aiqm-leaf);
  margin-right: 1px;
}

.meter-section-title::after {
  content: "";
  height: 1px;
  flex: 1 1 auto;
  background: linear-gradient(90deg, rgba(111, 156, 55, 0.34), transparent);
}

.meter,
.gpt-content .meter {
  border-top: 1px solid rgba(151, 132, 62, 0.18);
  border-radius: 7px;
}

.meter:hover {
  background: rgba(236, 246, 207, 0.34);
}

.meter-label {
  color: #263c18;
  font-weight: 760;
}

.meter-value {
  color: var(--aiqm-leaf-dark);
  font-weight: 740;
}

.bar {
  height: 7px;
  background: #e6ecd4;
  border: 1px solid rgba(120, 141, 70, 0.22);
  box-shadow: inset 0 1px 2px rgba(66, 82, 43, 0.12);
  overflow: visible;
}

.bar-fill {
  position: relative;
  background: linear-gradient(90deg, #8cbf49, #d3bd55);
  box-shadow: 0 0 8px rgba(132, 181, 73, 0.22);
}

.bar-fill.remaining-fill {
  background: linear-gradient(90deg, #79ad3f, #bddc68);
}

.bar-fill::after {
  content: "";
  position: absolute;
  top: 50%;
  right: -4px;
  width: 8px;
  height: 8px;
  border-radius: 2px 8px 2px 8px;
  background: linear-gradient(135deg, #f8ed9b, #76a93e);
  border: 1px solid rgba(90, 110, 42, 0.38);
  transform: translateY(-50%) rotate(18deg);
  box-shadow: 0 0 6px rgba(146, 194, 76, 0.35);
}

.sentinel-risk-normal {
  background: linear-gradient(90deg, #77ad3f, #bdda65);
}

.sentinel-risk-elevated {
  background: linear-gradient(90deg, #d8b83d, #f0d56c);
}

.sentinel-risk-high {
  background: linear-gradient(90deg, #df8b2d, #f2c15c);
}

.sentinel-risk-severe {
  background: linear-gradient(90deg, #cf4e3a, #ed8f68);
}

.sentinel-label {
  color: #667747;
}

.sentinel-explanation {
  color: #81745f;
}

.badge {
  border-color: rgba(151, 132, 62, 0.3);
  background: linear-gradient(180deg, #fffdf2, #eef5d8);
  color: #60743f;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.58);
}

.settings-popover {
  padding: 0 12px 12px;
}

.settings-header {
  border-bottom: 1px solid var(--aiqm-line);
  padding: 10px 0 9px;
}

.settings-check {
  color: var(--aiqm-leaf-dark);
}

.settings-input-wrap,
.settings-input {
  border-color: rgba(151, 132, 62, 0.34);
  background: rgba(255, 253, 244, 0.86);
  color: var(--aiqm-ink);
}

.settings-input::placeholder {
  color: rgba(92, 105, 63, 0.58);
}

.settings-actions {
  justify-content: flex-start;
}

.settings-input-wrap:focus-within,
.settings-input:focus {
  border-color: rgba(111, 156, 55, 0.78);
}

.settings-eye-button {
  box-shadow: none;
}

.empty {
  color: var(--aiqm-muted);
}

.error,
.error-text {
  color: #c94432;
}

@media (max-width: 480px) {
  .gpt-panel {
    width: min(380px, calc(100vw - 16px));
    height: min(540px, calc(100vh - 18px));
  }

  .gpt-title {
    font-size: 16px;
  }

  .gpt-alerts {
    display: none;
  }

  .meter-section {
    padding-inline: 10px;
  }
}

/* Compact Nahida asset skin. Small functional ornaments, no oversized hero art. */
:host {
  --nahida-green: #3e7a35;
  --nahida-green-dark: #2f5f27;
  --nahida-gold: #c9a24a;
  --nahida-gold-soft: #e5cf86;
  --nahida-cream: #fffaf0;
  --nahida-paper: #fbf6df;
  --nahida-border: rgba(190, 153, 58, 0.52);
  --nahida-shadow: 0 14px 34px rgba(47, 74, 30, 0.2);
  --nahida-muted: #746d5a;
  --nahida-text: #3f4b2d;
}

.panel,
.gpt-panel,
.gpt-collapsed-panel,
.settings-popover {
  border-color: var(--nahida-border);
  background:
    radial-gradient(circle at 18% 0%, rgba(207, 232, 154, 0.28), transparent 32%),
    radial-gradient(circle at 100% 14%, rgba(229, 207, 134, 0.18), transparent 28%),
    linear-gradient(180deg, rgba(255, 253, 244, 0.97), rgba(251, 246, 223, 0.96));
  color: var(--nahida-text);
  box-shadow: var(--nahida-shadow), inset 0 0 0 1px rgba(255, 255, 255, 0.72);
}

.panel,
.gpt-panel,
.gpt-collapsed-panel {
  position: relative;
}

.gpt-panel {
  width: min(380px, calc(100vw - 16px));
  height: min(540px, calc(100vh - 16px));
  min-height: 380px;
  border-radius: 14px;
}

.panel {
  width: min(300px, calc(100vw - 24px));
  border-radius: 12px;
}

.settings-popover {
  position: fixed;
  width: min(330px, calc(100vw - 20px));
  border-radius: 12px;
}

.panel-corners,
.card-corners {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.corner,
.card-corner,
.title-icon,
.section-title-icon,
.inline-icon,
.section-badge,
.progress-leaf,
.chip-icon,
.vine-divider-image {
  display: block;
  object-fit: contain;
  user-select: none;
  -webkit-user-select: none;
}

.corner {
  position: absolute;
  width: 38px;
  height: 34px;
  opacity: 0.72;
}

.compact-corners .corner {
  width: 30px;
  height: 27px;
  opacity: 0.62;
}

.corner-top-left {
  top: 3px;
  left: 3px;
}

.corner-top-right {
  top: 3px;
  right: 3px;
}

.corner-bottom-left {
  bottom: 3px;
  left: 3px;
}

.corner-bottom-right {
  right: 3px;
  bottom: 3px;
}

.header,
.meta,
.model-meta,
.content,
.gpt-content,
.vine-divider,
.settings-header,
.settings-check,
.settings-label,
.settings-input-wrap,
.settings-help,
.settings-actions {
  position: relative;
  z-index: 1;
}

.header {
  min-height: 48px;
  padding: 10px 12px 8px;
  background:
    linear-gradient(180deg, rgba(255, 253, 242, 0.94), rgba(247, 242, 217, 0.88)),
    linear-gradient(90deg, rgba(159, 207, 90, 0.12), transparent 48%, rgba(229, 207, 134, 0.12));
}

.gpt-header {
  min-height: 54px;
  padding: 10px 12px 9px;
}

.title,
.gpt-title,
.settings-title,
.meter-section-title {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.title::before,
.gpt-title::before,
.settings-title::before,
.meter-section-title::before {
  content: none;
  margin: 0;
}

.title-text,
.section-title-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title-icon {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  filter: drop-shadow(0 2px 4px rgba(61, 84, 36, 0.18));
}

.gpt-title .title-icon {
  width: 24px;
  height: 24px;
  flex-basis: 24px;
}

.gpt-title {
  font-size: 18px;
}

.title {
  font-size: 14px;
}

.gpt-alerts {
  padding: 3px 8px;
  font-size: 11px;
  color: #667747;
  background: linear-gradient(180deg, rgba(255, 253, 241, 0.86), rgba(239, 246, 214, 0.82));
}

.actions,
.gpt-actions {
  gap: 6px;
}

.icon-button {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border-color: rgba(169, 140, 55, 0.5);
  background: linear-gradient(145deg, #fffdf5, #eef5d8);
  color: var(--nahida-green-dark);
}

.icon-button:hover {
  border-color: rgba(62, 122, 53, 0.62);
  background: linear-gradient(145deg, #fffef8, #e8f3ce);
}

.meta {
  padding: 7px 12px;
  font-size: 11px;
}

.gpt-panel > .meta {
  padding: 7px 12px 5px;
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.inline-icon {
  width: 12px;
  height: 12px;
  flex: 0 0 12px;
}

.vine-divider {
  height: 16px;
  margin: 0 12px 2px;
  display: grid;
  place-items: center;
  overflow: hidden;
}

.panel .vine-divider {
  height: 12px;
  margin-inline: 10px;
}

.vine-divider-image {
  width: 100%;
  height: 100%;
  opacity: 0.62;
}

.gpt-content {
  padding: 0 10px 10px;
  scrollbar-width: thin;
  scrollbar-color: rgba(95, 122, 54, 0.32) transparent;
}

.content {
  padding: 4px 10px 10px;
}

.gpt-content::-webkit-scrollbar,
.gpt-content:hover::-webkit-scrollbar,
.gpt-content:focus-within::-webkit-scrollbar {
  width: 6px;
}

.meter-section {
  margin-top: 8px;
  padding: 10px 12px 9px;
  border-color: rgba(190, 153, 58, 0.3);
  border-radius: 9px;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.68),
    0 7px 16px rgba(73, 84, 47, 0.08);
  overflow: hidden;
}

.gpt-content .meter-section {
  margin-top: 9px;
}

.meter-section::after {
  content: none;
}

.meter-section::before {
  content: "";
  position: absolute;
  inset: 4px;
  border: 1px solid rgba(190, 153, 58, 0.14);
  border-radius: 6px;
  pointer-events: none;
  z-index: 0;
}

.card-corners {
  opacity: 0.42;
}

.card-corner {
  position: absolute;
  width: 18px;
  height: 16px;
  opacity: 0.5;
}

.card-corner-top-left {
  top: 3px;
  left: 3px;
}

.card-corner-bottom-right {
  display: none;
}

.meter-section-title {
  position: relative;
  z-index: 1;
  padding: 1px 30px 6px 0;
  color: var(--nahida-green-dark);
  font-size: 13px;
  font-weight: 780;
}

.section-title-icon {
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
}

.meter-section-title::after {
  min-width: 24px;
  background: linear-gradient(90deg, rgba(111, 156, 55, 0.35), rgba(201, 162, 74, 0.24), transparent);
}

.section-badge {
  position: absolute;
  top: 8px;
  right: 10px;
  width: 22px;
  height: 22px;
  z-index: 1;
  opacity: 0.86;
  filter: drop-shadow(0 3px 5px rgba(61, 84, 36, 0.16));
}

.shield-badge {
  top: 27px;
  width: 34px;
  height: 34px;
}

.sentinel-block,
.meter {
  position: relative;
  z-index: 1;
}

.sentinel-block {
  padding: 3px 0 1px;
}

.sentinel-row {
  font-size: 12px;
  padding: 2px 0;
}

.sentinel-explanation {
  font-size: 11px;
}

.ip-risk-block {
  padding-right: 42px;
}

.meter,
.gpt-content .meter {
  padding: 8px 0;
  border-top-color: rgba(151, 132, 62, 0.18);
}

.meter-label,
.meter-value {
  font-size: 12px;
}

.bar {
  position: relative;
  height: 7px;
  margin-top: 7px;
  overflow: visible;
}

.bar-fill::after {
  content: none;
}

.progress-leaf {
  position: absolute;
  top: 50%;
  left: clamp(7px, var(--meter-progress), calc(100% - 7px));
  width: 14px;
  height: 14px;
  transform: translate(-50%, -50%) rotate(-18deg);
  filter: drop-shadow(0 1px 2px rgba(55, 75, 36, 0.28));
  pointer-events: none;
}

.meter-bottom {
  margin-top: 5px;
  font-size: 10.5px;
}

.badge {
  padding: 2px 6px;
  color: #60743f;
}

.badge::before {
  content: "✤";
  margin-right: 4px;
  color: var(--nahida-green);
}

.collapsed,
.gpt-restore-chip {
  grid-template-columns: 18px 8px minmax(0, 1fr);
  border-radius: 999px;
  overflow: visible;
  position: relative;
}

.chip-icon {
  width: 18px;
  height: 18px;
  opacity: 0.86;
}

.capsule-mascot {
  position: absolute;
  left: 50%;
  bottom: calc(100% - 5px);
  z-index: 5;
  width: 62px;
  height: auto;
  max-width: none;
  object-fit: contain;
  object-position: center bottom;
  pointer-events: none;
  transform: translateX(-50%);
  filter: drop-shadow(0 4px 7px rgba(43, 61, 28, 0.22));
}

.gpt-collapsed-panel {
  width: min(360px, calc(100vw - 16px));
  min-height: 46px;
  grid-template-columns: minmax(88px, auto) minmax(72px, 1fr) auto;
  border-radius: 14px;
  padding: 8px 10px;
  overflow: visible;
  position: relative;
}

.gpt-collapsed-panel .capsule-mascot {
  bottom: calc(100% - 6px);
  width: 68px;
}

.gpt-collapsed-panel .gpt-title {
  font-size: 15px;
}

.gpt-collapsed-panel .title-icon {
  width: 20px;
  height: 20px;
  flex-basis: 20px;
}

.gpt-collapsed-summary {
  font-size: 12px;
}

.settings-title .title-icon {
  width: 20px;
  height: 20px;
  flex-basis: 20px;
}

@media (max-width: 420px) {
  .gpt-panel {
    width: min(360px, calc(100vw - 12px));
    height: min(520px, calc(100vh - 14px));
  }

  .gpt-collapsed-panel {
    width: min(340px, calc(100vw - 12px));
    grid-template-columns: minmax(82px, auto) minmax(48px, 1fr) auto;
  }

  .gpt-alerts {
    display: none;
  }
}
`;
  const PLATFORM_LABEL = {
    grok: "Grok",
    claude: "Claude",
    chatgpt: "GPT"
  };
  const GPT_SECTION_ORDER = [
    "input",
    "features",
    "windows",
    "codex",
    "other"
  ];
  const GPT_SECTION_LABELS = {
    input: "输入与附件",
    features: "GPT 功能额度",
    windows: "用量窗口",
    codex: "余额 / Codex",
    other: "其他"
  };
  const SOURCE_LABEL = {
    api: "接口",
    intercepted: "捕获",
    estimate: "估算",
    unknown: "未知"
  };
  const CONFIDENCE_LABEL = {
    high: "高",
    medium: "中",
    low: "低"
  };
  const STATUS_LABEL = {
    ok: "正常",
    partial: "部分可用",
    unknown: "未知",
    error: "错误"
  };
  const METER_LABELS = {
    "File Upload": "文件上传",
    "Paste Text To File": "粘贴文本转文件",
    Dictation: "听写",
    "Deep Research": "深度研究",
    "Image Generation": "图像生成",
    "Primary window": "主窗口",
    "Weekly window": "每周窗口",
    "Tasks rate limit": "任务限额",
    "Code Review": "代码审查",
    Credits: "余额",
    "Credits (unlimited)": "余额（无限）"
  };
  class UsageWidget {
    constructor(platform2, onRefresh, handlers = {}) {
      this.platform = platform2;
      this.onRefresh = onRefresh;
      this.handlers = handlers;
      this.expanded = false;
      this.hidden = platform2 === "chatgpt";
      this.host.dataset.platform = platform2;
      const style = document.createElement("style");
      style.textContent = WIDGET_CSS;
      this.shadow.append(style, this.root);
      this.timerId = window.setInterval(() => this.render(), 15e3);
    }
    host = document.createElement("div");
    shadow = this.host.attachShadow({ mode: "open" });
    root = document.createElement("div");
    expanded = false;
    hidden = false;
    chipPosition = { edge: "right", offset: 96 };
    loading = false;
    snapshot = null;
    chatGptSentinelState = null;
    ipRiskState = null;
    ipRiskSettings = {
      provider: "proxycheck",
      enabled: false,
      hasApiKey: false,
      apiKeyPreview: null
    };
    ipRiskRefreshing = false;
    ipRiskSettingsOpen = false;
    backoffUntil = 0;
    timerId;
    mount() {
      document.documentElement.append(this.host);
      this.render();
    }
    destroy() {
      window.clearInterval(this.timerId);
      this.host.remove();
    }
    setSnapshot(snapshot) {
      this.snapshot = snapshot;
      this.render();
    }
    setLoading(value) {
      this.loading = value;
      this.render();
    }
    setChatGptSentinelState(value) {
      this.chatGptSentinelState = value;
      this.render();
    }
    setIpRiskSettings(value) {
      this.ipRiskSettings = value;
      this.render();
    }
    setIpRiskState(value) {
      this.ipRiskState = value;
      this.render();
    }
    setIpRiskRefreshing(value) {
      this.ipRiskRefreshing = value;
      this.render();
    }
    setBackoffUntil(value) {
      this.backoffUntil = value;
      this.render();
    }
    render() {
      if (this.hidden) {
        this.ipRiskSettingsOpen = false;
        this.root.replaceChildren(
          this.platform === "chatgpt" ? this.renderChatGptRestoreChip() : emptyNode()
        );
        return;
      }
      if (this.platform === "chatgpt") {
        if (!this.hidden) {
          this.resetPanelPosition();
        }
        this.replaceRootWith(
          this.expanded ? this.renderChatGptPanel() : this.renderChatGptCollapsed()
        );
        return;
      }
      this.replaceRootWith(this.expanded ? this.renderPanel() : this.renderCollapsed());
    }
    replaceRootWith(main) {
      if (this.ipRiskSettingsOpen) {
        this.root.replaceChildren(main, this.renderIpRiskSettingsDialog());
        return;
      }
      this.root.replaceChildren(main);
    }
    renderChatGptRestoreChip() {
      const button = el("button", "gpt-restore-chip");
      button.type = "button";
      this.applyChipPosition();
      button.setAttribute("aria-label", "恢复 GPT 用量面板");
      this.installChipDrag(button, () => {
        this.hidden = false;
        this.expanded = true;
        this.resetPanelPosition();
        this.render();
      });
      button.append(
        decorativeAsset("capsule-mascot.png", "capsule-mascot"),
        decorativeAsset("leaf-emblem.png", "chip-icon"),
        el("span", `status-dot status-${this.snapshot?.status ?? "unknown"}`),
        node("span", "collapsed-main", [
          textEl("span", "platform", "GPT"),
          textEl("span", "primary", this.chatGptPrimaryValue())
        ])
      );
      return button;
    }
    applyChipPosition() {
      const margin = 8;
      this.host.style.top = "";
      this.host.style.right = "";
      this.host.style.bottom = "";
      this.host.style.left = "";
      this.host.style.transform = "none";
      if (this.chipPosition.edge === "left") {
        this.host.style.left = `${margin}px`;
        this.host.style.top = `${this.chipPosition.offset}px`;
        return;
      }
      if (this.chipPosition.edge === "right") {
        this.host.style.right = `${margin}px`;
        this.host.style.top = `${this.chipPosition.offset}px`;
        return;
      }
      if (this.chipPosition.edge === "top") {
        this.host.style.top = `${margin}px`;
        this.host.style.left = `${this.chipPosition.offset}px`;
        return;
      }
      this.host.style.bottom = `${margin}px`;
      this.host.style.left = `${this.chipPosition.offset}px`;
    }
    resetPanelPosition() {
      if (this.platform !== "chatgpt") {
        return;
      }
      this.host.style.top = "";
      this.host.style.right = "";
      this.host.style.bottom = "";
      this.host.style.left = "";
      this.host.style.transform = "";
    }
    installChipDrag(button, onActivate) {
      let startX = 0;
      let startY = 0;
      let moved = false;
      const onPointerMove = (event) => {
        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;
        if (!moved && Math.hypot(deltaX, deltaY) < 4) {
          return;
        }
        moved = true;
        this.updateChipPositionFromPoint(event.clientX, event.clientY);
        this.applyChipPosition();
      };
      const onPointerUp = (event) => {
        button.releasePointerCapture(event.pointerId);
        button.removeEventListener("pointermove", onPointerMove);
        button.removeEventListener("pointerup", onPointerUp);
        button.removeEventListener("pointercancel", onPointerUp);
        if (!moved) {
          onActivate();
        }
      };
      button.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) {
          return;
        }
        startX = event.clientX;
        startY = event.clientY;
        moved = false;
        button.setPointerCapture(event.pointerId);
        button.addEventListener("pointermove", onPointerMove);
        button.addEventListener("pointerup", onPointerUp);
        button.addEventListener("pointercancel", onPointerUp);
      });
    }
    updateChipPositionFromPoint(clientX, clientY) {
      const margin = 8;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const distances = {
        left: clientX,
        right: viewportWidth - clientX,
        top: clientY,
        bottom: viewportHeight - clientY
      };
      const edge = Object.entries(distances).sort((a, b) => a[1] - b[1])[0][0] ?? "right";
      if (edge === "left" || edge === "right") {
        this.chipPosition = {
          edge,
          offset: clamp$1(clientY - 24, margin, viewportHeight - 56)
        };
        return;
      }
      this.chipPosition = {
        edge,
        offset: clamp$1(clientX - 44, margin, viewportWidth - 96)
      };
    }
    renderChatGptCollapsed() {
      const panel = el("section", "gpt-collapsed-panel");
      const title = titleNode("gpt-title", "GPT 用量", "clover-medallion.png");
      const summary = textEl("div", "gpt-collapsed-summary", this.criticalSummary());
      const actions = el("div", "gpt-actions");
      const refresh = this.renderActionButton(
        this.loading ? "..." : "↻",
        "刷新用量",
        () => this.onRefresh()
      );
      refresh.disabled = this.loading || this.backoffRemainingMs() > 0;
      const expand = this.renderActionButton("+", "展开用量面板", () => {
        this.expanded = true;
        this.render();
      });
      const close = this.renderActionButton("×", "隐藏用量面板", () => {
        this.hidden = true;
        this.render();
      });
      actions.append(this.renderSettingsButton(), refresh, expand, close);
      panel.append(decorativeAsset("capsule-mascot.png", "capsule-mascot"), title, summary, actions);
      return panel;
    }
    renderChatGptPanel() {
      const panel = el("section", "gpt-panel");
      panel.append(
        panelCorners("panel-corners"),
        this.renderChatGptHeader(),
        this.renderMeta(),
        vineDivider(),
        this.renderChatGptContent()
      );
      return panel;
    }
    renderChatGptHeader() {
      const header = el("div", "header gpt-header");
      const title = titleNode("title gpt-title", "GPT 用量", "clover-medallion.png");
      const right = el("div", "gpt-header-right");
      right.append(textEl("span", "gpt-alerts", `${this.alertCount()} 项预警`));
      const actions = el("div", "actions gpt-actions");
      const refresh = this.renderActionButton(
        this.loading ? "..." : "↻",
        "刷新用量",
        () => this.onRefresh()
      );
      refresh.disabled = this.loading || this.backoffRemainingMs() > 0;
      const collapse = this.renderActionButton("−", "折叠用量面板", () => {
        this.expanded = false;
        this.render();
      });
      const close = this.renderActionButton("×", "隐藏用量面板", () => {
        this.hidden = true;
        this.render();
      });
      actions.append(this.renderSettingsButton(), refresh, collapse, close);
      right.append(actions);
      header.append(title, right);
      return header;
    }
    renderChatGptContent() {
      const content = el("div", "content gpt-content");
      if (this.snapshot?.errorMessage) {
        content.append(textEl("div", "error", this.snapshot.errorMessage));
      }
      const sentinelSection = this.renderChatGptSentinelSection();
      if (sentinelSection) {
        content.append(sentinelSection);
      }
      content.append(this.renderIpRiskSection());
      const meters = this.chatGptMeters();
      if (meters.length === 0) {
        if (!sentinelSection && !this.ipRiskSettings.enabled) {
          content.append(textEl("div", "empty", "暂无用量数据"));
        }
        return content;
      }
      for (const section of groupChatGptMeters(meters)) {
        content.append(this.renderMeterSection(section.label, section.meters));
      }
      return content;
    }
    renderChatGptSentinelSection() {
      const state = this.chatGptSentinelState;
      if (!state) {
        return null;
      }
      const section = el("section", "meter-section sentinel-section");
      section.append(cardCorners(), decorativeAsset("gem-square.png", "section-badge"));
      section.append(sectionTitle("账号状态", "leaf-small.png"));
      const gate = el("div", "sentinel-block");
      gate.append(
        this.renderSentinelRow(
          "发送门禁",
          `${state.sentinelRisk.label} ${state.sentinelRisk.score}/100`
        ),
        this.renderSentinelBar(state.sentinelRisk.score),
        this.renderSentinelRow(
          "PoW",
          `${state.pow.raw ?? "-"} / ${state.pow.level} / ${state.pow.risk}`
        ),
        textEl("div", "sentinel-explanation", `说明：${state.explanation}`)
      );
      section.append(gate);
      return section;
    }
    renderIpRiskSection() {
      const section = el("section", "meter-section ip-risk-section");
      section.append(cardCorners(), decorativeAsset("shield.png", "section-badge shield-badge"));
      section.append(sectionTitle("网络风险", "leaf-small.png"));
      const block = el("div", "sentinel-block ip-risk-block");
      block.append(this.renderSentinelRow("IP 检测", this.ipRiskStatusText()));
      const freshIpRisk = this.freshIpRiskState();
      if (freshIpRisk) {
        block.append(
          this.renderSentinelBar(freshIpRisk.score),
          this.renderSentinelRow("信号", formatIpRiskSignals(freshIpRisk)),
          this.renderSentinelRow("来源", freshIpRisk.source)
        );
      } else if (this.ipRiskRefreshing) {
        block.append(textEl("div", "sentinel-explanation", "正在查询 proxycheck.io。"));
      } else if (this.ipRiskSettings.enabled && this.ipRiskSettings.hasApiKey && this.ipRiskState?.status === "error") {
        block.append(
          textEl(
            "div",
            "sentinel-explanation error-text",
            this.ipRiskState.errorMessage ?? "检测失败"
          )
        );
      } else {
        block.append(
          textEl(
            "div",
            "sentinel-explanation",
            this.ipRiskSettings.enabled ? "proxycheck.io 密钥仅保存在本地，检测结果不代表 OpenAI 官方账号状态。" : "可在设置中启用 proxycheck.io 作为第三方 IP 信誉检测源。"
          )
        );
      }
      section.append(block);
      return section;
    }
    renderIpRiskSettingsDialog() {
      const panel = el("section", "settings-popover");
      const header = el("div", "settings-header");
      header.append(
        titleNode("settings-title", "IP 检测设置", "shield.png"),
        this.renderActionButton("×", "关闭 IP 检测设置", () => {
          this.ipRiskSettingsOpen = false;
          this.render();
        })
      );
      const enabledInput = document.createElement("input");
      enabledInput.type = "checkbox";
      enabledInput.checked = this.ipRiskSettings.enabled;
      const enabledLabel = el("label", "settings-check");
      enabledLabel.append(enabledInput, textEl("span", "", "启用 proxycheck.io"));
      const keyInputWrap = el("div", "settings-input-wrap");
      const keyInput = document.createElement("input");
      keyInput.className = "settings-input";
      keyInput.type = "password";
      keyInput.autocomplete = "off";
      keyInput.spellcheck = false;
      let keyDirty = false;
      if (this.ipRiskSettings.apiKeyPreview) {
        keyInput.value = this.ipRiskSettings.apiKeyPreview;
      }
      keyInput.placeholder = this.ipRiskSettings.hasApiKey ? "已保存密钥，留空则不修改" : "输入 proxycheck.io API 密钥";
      const prepareKeyEdit = () => {
        if (!keyDirty && this.ipRiskSettings.hasApiKey) {
          keyDirty = true;
          keyInput.value = "";
          keyInput.placeholder = "输入新的 proxycheck.io API 密钥";
          keyInput.type = "password";
        }
      };
      keyInput.addEventListener("keydown", (event) => {
        if (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete") {
          prepareKeyEdit();
        }
      });
      keyInput.addEventListener("paste", prepareKeyEdit);
      keyInput.addEventListener("input", () => {
        keyDirty = true;
      });
      const reveal = this.renderActionButton("👁", "显示或隐藏密钥", () => {
        keyInput.type = keyInput.type === "password" ? "text" : "password";
      });
      reveal.classList.add("settings-eye-button");
      keyInputWrap.append(keyInput, reveal);
      const actions = el("div", "settings-actions");
      const save = textEl("button", "settings-button primary-button", "保存");
      save.type = "button";
      save.addEventListener("click", () => {
        const inputValue = keyInput.value.trim();
        const previewValue = this.ipRiskSettings.apiKeyPreview ?? "";
        this.handlers.onIpRiskSettingsSave?.({
          enabled: enabledInput.checked,
          apiKey: inputValue && inputValue !== previewValue ? inputValue : void 0
        });
        this.ipRiskSettingsOpen = false;
        this.render();
      });
      const refresh = textEl("button", "settings-button", "立即检测");
      refresh.type = "button";
      refresh.disabled = this.ipRiskRefreshing || !this.ipRiskSettings.enabled || !this.ipRiskSettings.hasApiKey;
      refresh.addEventListener("click", () => {
        this.handlers.onIpRiskRefresh?.();
        this.ipRiskSettingsOpen = false;
        this.render();
      });
      const remove = textEl("button", "settings-button danger-button", "删除密钥");
      remove.type = "button";
      remove.disabled = !this.ipRiskSettings.hasApiKey;
      remove.addEventListener("click", () => {
        this.handlers.onIpRiskSettingsSave?.({
          enabled: enabledInput.checked,
          clearApiKey: true
        });
        this.ipRiskSettingsOpen = false;
        this.render();
      });
      actions.append(save, refresh, remove);
      panel.append(
        header,
        enabledLabel,
        textEl("label", "settings-label", "proxycheck.io API 密钥"),
        keyInputWrap,
        textEl(
          "div",
          "settings-help",
          "密钥保存在 chrome.storage.local。检测会先临时获取当前公网 IP，再查询 proxycheck.io，不保存历史 IP。"
        ),
        actions
      );
      return panel;
    }
    ipRiskStatusText() {
      if (!this.ipRiskSettings.enabled) {
        return "未启用";
      }
      if (!this.ipRiskSettings.hasApiKey) {
        return "未配置密钥";
      }
      if (this.ipRiskRefreshing) {
        return "检测中";
      }
      if (this.ipRiskSettings.enabled && this.ipRiskSettings.hasApiKey && this.ipRiskState?.status === "error") {
        return "检测失败";
      }
      const freshIpRisk = this.freshIpRiskState();
      if (freshIpRisk) {
        return `${freshIpRisk.label} ${freshIpRisk.score}/100`;
      }
      return "等待检测";
    }
    freshIpRiskState() {
      const state = this.ipRiskState;
      if (this.ipRiskSettings.enabled && this.ipRiskSettings.hasApiKey && state?.status === "ok" && typeof state.score === "number") {
        return state;
      }
      return null;
    }
    renderSentinelRow(label, value) {
      const row = el("div", "sentinel-row");
      row.append(textEl("span", "sentinel-label", label), textEl("span", "", value));
      return row;
    }
    renderSentinelBar(score) {
      const bar = el("div", "bar sentinel-bar");
      const fill = el("div", `bar-fill sentinel-fill ${sentinelRiskClass(score)}`);
      const progress = clampPercent(score);
      fill.style.width = `${progress}%`;
      bar.style.setProperty("--meter-progress", `${progress}%`);
      bar.append(fill, decorativeAsset("leaf-small.png", "progress-leaf"));
      return bar;
    }
    renderMeterSection(label, meters) {
      const section = el("section", "meter-section");
      section.append(cardCorners(), sectionTitle(label, "leaf-small.png"));
      for (const meter of meters) {
        section.append(this.renderMeter(meter));
      }
      return section;
    }
    renderActionButton(text, label, onClick) {
      const button = textEl("button", "icon-button", text);
      button.type = "button";
      button.setAttribute("aria-label", label);
      button.title = label;
      button.addEventListener("click", onClick);
      return button;
    }
    renderSettingsButton() {
      return this.renderActionButton("⚙", "IP 检测设置", () => {
        this.ipRiskSettingsOpen = !this.ipRiskSettingsOpen;
        this.render();
      });
    }
    renderCollapsed() {
      const button = el("button", "collapsed");
      button.type = "button";
      button.setAttribute("aria-label", `打开 ${PLATFORM_LABEL[this.platform]} 用量`);
      this.applyChipPosition();
      this.installChipDrag(button, () => {
        this.expanded = true;
        this.render();
      });
      button.append(
        decorativeAsset("capsule-mascot.png", "capsule-mascot"),
        decorativeAsset(platformTitleAsset(this.platform), "chip-icon"),
        el("span", `status-dot status-${this.snapshot?.status ?? "unknown"}`),
        node("span", "collapsed-main", [
          textEl("span", "platform", PLATFORM_LABEL[this.platform]),
          textEl("span", "primary", this.collapsedPrimaryValue())
        ])
      );
      return button;
    }
    renderPanel() {
      const panel = el("section", "panel");
      panel.append(panelCorners("panel-corners compact-corners"), this.renderHeader(), this.renderMeta(), vineDivider());
      if (this.platform === "grok") {
        const modelMeta = this.renderGrokModelMeta();
        if (modelMeta) {
          panel.append(modelMeta);
        }
      }
      panel.append(this.renderContent());
      return panel;
    }
    renderHeader() {
      const header = el("div", "header");
      const title = titleNode(
        "title",
        `${PLATFORM_LABEL[this.platform]} 用量`,
        platformTitleAsset(this.platform)
      );
      const actions = el("div", "actions");
      const refresh = textEl("button", "icon-button", this.loading ? "..." : "↻");
      refresh.type = "button";
      refresh.setAttribute("aria-label", "刷新用量");
      refresh.title = "刷新用量";
      refresh.disabled = this.loading || this.backoffRemainingMs() > 0;
      refresh.addEventListener("click", this.onRefresh);
      const close = textEl("button", "icon-button", "×");
      close.type = "button";
      close.setAttribute("aria-label", "收起用量组件");
      close.title = "收起";
      close.addEventListener("click", () => {
        this.expanded = false;
        this.render();
      });
      actions.append(this.renderSettingsButton(), refresh, close);
      header.append(title, actions);
      return header;
    }
    renderMeta() {
      const meta = el("div", "meta");
      const updated = this.snapshot ? `更新于 ${formatAge(this.snapshot.updatedAt)}` : "尚未更新";
      const right = this.backoffRemainingMs() > 0 ? `等待 ${Math.ceil(this.backoffRemainingMs() / 1e3)}秒` : this.snapshot?.cacheAgeMs !== void 0 ? `缓存 ${Math.floor(this.snapshot.cacheAgeMs / 1e3)}秒` : this.loading ? "加载中" : "";
      meta.append(
        iconText("span", "meta-item", "leaf-small.png", updated),
        right ? iconText("span", "meta-item", "leaf-small.png", right) : textEl("span", "", "")
      );
      return meta;
    }
    renderGrokModelMeta() {
      const summary = this.grokModelSummary();
      if (!summary) {
        return null;
      }
      const meta = el("div", "model-meta");
      const value = textEl("span", "model-value", summary);
      value.title = summary;
      meta.append(textEl("span", "model-label", "模型"), value);
      return meta;
    }
    renderContent() {
      const content = el("div", "content");
      if (this.snapshot?.errorMessage) {
        content.append(textEl("div", "error", this.snapshot.errorMessage));
      }
      content.append(this.renderIpRiskSection());
      const meters = this.snapshot?.meters ?? [];
      if (meters.length === 0) {
        return content;
      }
      for (const meter of meters) {
        content.append(this.renderMeter(meter));
      }
      return content;
    }
    renderMeter(meter) {
      const row = el("div", "meter");
      const top = el("div", "meter-top");
      top.append(
        textEl("div", "meter-label", formatMeterLabel(meter)),
        textEl("div", "meter-value", formatMeterValue(meter))
      );
      const progress = meterProgress(meter);
      const bar = el("div", "bar");
      const fill = el("div", "bar-fill");
      if (typeof meter.remainingPercent === "number") {
        fill.classList.add("remaining-fill");
      }
      fill.style.width = `${progress}%`;
      bar.style.setProperty("--meter-progress", `${progress}%`);
      bar.append(fill, decorativeAsset("leaf-small.png", "progress-leaf"));
      const bottom = el("div", "meter-bottom");
      const age = meter.observedAt ? ` · ${formatAge(meter.observedAt)}` : "";
      bottom.append(
        textEl(
          "span",
          "badge",
          `${sourceLabel(meter.source)} · ${confidenceLabel(meter.confidence)}${age}`
        ),
        textEl("span", "", formatReset(meter))
      );
      row.append(top, bar, bottom);
      return row;
    }
    primaryValue() {
      const meters = this.snapshot?.meters ?? [];
      const byRemaining = meters.filter((meter) => typeof meter.remaining === "number").sort((a, b) => (a.remaining ?? 0) - (b.remaining ?? 0))[0];
      if (byRemaining?.remaining !== void 0 && byRemaining.remaining !== null) {
        return `${byRemaining.remaining}`;
      }
      const byRemainingPercent = meters.filter((meter) => typeof meter.remainingPercent === "number").sort((a, b) => (a.remainingPercent ?? 0) - (b.remainingPercent ?? 0))[0];
      if (byRemainingPercent?.remainingPercent !== void 0 && byRemainingPercent.remainingPercent !== null) {
        return `${Math.round(byRemainingPercent.remainingPercent)}% 剩余`;
      }
      const byPercent = meters.find((meter) => typeof meter.usedPercent === "number");
      if (byPercent?.usedPercent !== void 0 && byPercent.usedPercent !== null) {
        return `${Math.round(byPercent.usedPercent)}%`;
      }
      return "?";
    }
    collapsedPrimaryValue() {
      if (this.platform === "grok") {
        return this.grokPrimaryValue();
      }
      return this.primaryValue();
    }
    alertCount() {
      return this.chatGptMeters().filter(isAlertMeter).length;
    }
    criticalSummary() {
      const meters = this.chatGptMeters();
      const alert = meters.find((meter) => typeof meter.remaining === "number" && meter.remaining <= 0) ?? meters.find((meter) => typeof meter.remainingPercent === "number" && meter.remainingPercent <= 5) ?? meters.filter((meter) => typeof meter.usedPercent === "number").sort((a, b) => (b.usedPercent ?? 0) - (a.usedPercent ?? 0))[0] ?? meters.filter((meter) => typeof meter.remaining === "number").sort((a, b) => (a.remaining ?? 0) - (b.remaining ?? 0))[0];
      if (!alert) {
        return statusLabel(this.snapshot?.status ?? "unknown");
      }
      if (typeof alert.remainingPercent === "number") {
        return `${shortLabel(formatMeterLabel(alert))} ${Math.round(alert.remainingPercent)}% 剩余`;
      }
      if (typeof alert.usedPercent === "number") {
        return `${shortLabel(formatMeterLabel(alert))} ${Math.round(alert.usedPercent)}%`;
      }
      if (typeof alert.remaining === "number") {
        return `${shortLabel(formatMeterLabel(alert))} 剩余 ${alert.remaining}`;
      }
      return shortLabel(formatMeterLabel(alert));
    }
    chatGptMeters() {
      const meters = [...this.snapshot?.meters ?? []];
      return meters.sort((a, b) => chatGptMeterPriority(a) - chatGptMeterPriority(b));
    }
    chatGptPrimaryValue() {
      const meters = this.chatGptMeters();
      const alert = meters.find((meter) => typeof meter.remaining === "number" && meter.remaining <= 0) ?? meters.find((meter) => typeof meter.remainingPercent === "number" && meter.remainingPercent <= 5) ?? meters.filter((meter) => typeof meter.remaining === "number").sort((a, b) => (a.remaining ?? 0) - (b.remaining ?? 0))[0] ?? meters.filter((meter) => typeof meter.remainingPercent === "number").sort((a, b) => (a.remainingPercent ?? 0) - (b.remainingPercent ?? 0))[0] ?? meters.find((meter) => typeof meter.usedPercent === "number");
      return alert ? formatMeterValue(alert) : "?";
    }
    backoffRemainingMs() {
      return Math.max(0, this.backoffUntil - Date.now());
    }
    grokModelSummary() {
      const values = unique(
        (this.snapshot?.meters ?? []).map((meter) => modelSummaryFromMeter(meter)).filter((value) => Boolean(value))
      );
      return values.join(", ");
    }
    grokPrimaryValue() {
      const meter = this.grokPrimaryMeter();
      if (!meter) {
        return this.primaryValue();
      }
      return formatMeterValue(meter);
    }
    grokPrimaryMeter() {
      const meters = [...this.snapshot?.meters ?? []];
      return meters.sort(
        (a, b) => grokMeterPriority(a) - grokMeterPriority(b) || (b.observedAt ?? 0) - (a.observedAt ?? 0)
      )[0] ?? null;
    }
  }
  function formatMeterValue(meter) {
    if (typeof meter.remainingPercent === "number") {
      return `${Math.round(meter.remainingPercent)}% 剩余`;
    }
    if (typeof meter.remaining === "number" && typeof meter.total === "number") {
      return `${meter.remaining}/${meter.total}`;
    }
    if (typeof meter.remaining === "number") {
      return `剩余 ${meter.remaining}`;
    }
    if (typeof meter.used === "number" && typeof meter.total === "number") {
      return `已用 ${meter.used}/${meter.total}`;
    }
    if (typeof meter.usedPercent === "number") {
      return `${Math.round(meter.usedPercent)}% 已用`;
    }
    return "未知";
  }
  function formatMeterLabel(meter) {
    const direct = METER_LABELS[meter.label];
    if (direct) {
      return direct;
    }
    return meter.label.replace(/\bquery limit\b/gi, "查询额度").replace(/\btoken limit\b/gi, "token 额度").replace(/\bLow \/ Fast \/ Normal\b/g, "低 / 快速 / 普通").replace(/\bHigh \/ Thinking \/ Expert\b/g, "高 / 思考 / 专家").replace(/\bCodex usage\b/gi, "Codex 用量").replace(/\bPrimary window\b/gi, "主窗口").replace(/\bWeekly window\b/gi, "每周窗口").replace(/\b5[- ]?hour\b/gi, "5 小时").replace(/\bweekly\b/gi, "每周").replace(/\busage limit\b/gi, "使用限额").replace(/\brate limit\b/gi, "使用限额");
  }
  function sourceLabel(source) {
    return SOURCE_LABEL[source] ?? source;
  }
  function confidenceLabel(confidence) {
    return CONFIDENCE_LABEL[confidence] ?? confidence;
  }
  function statusLabel(status) {
    return STATUS_LABEL[status] ?? status;
  }
  function meterProgress(meter) {
    if (typeof meter.remainingPercent === "number") {
      return clampPercent(meter.remainingPercent);
    }
    if (typeof meter.usedPercent === "number") {
      return clampPercent(meter.usedPercent);
    }
    if (typeof meter.remaining === "number" && typeof meter.total === "number" && meter.total > 0) {
      return clampPercent((meter.total - meter.remaining) / meter.total * 100);
    }
    return 0;
  }
  function clampPercent(value) {
    return Math.max(0, Math.min(100, value));
  }
  function sentinelRiskClass(score) {
    if (score >= 75) {
      return "sentinel-risk-severe";
    }
    if (score >= 50) {
      return "sentinel-risk-high";
    }
    if (score >= 25) {
      return "sentinel-risk-elevated";
    }
    return "sentinel-risk-normal";
  }
  function formatIpRiskSignals(state) {
    const signals = [];
    if (state.signals.proxy) {
      signals.push("Proxy");
    }
    if (state.signals.vpn) {
      signals.push("VPN");
    }
    if (state.signals.tor) {
      signals.push("Tor");
    }
    if (state.signals.hosting) {
      signals.push("Hosting");
    }
    if (state.signals.type && !signals.includes(state.signals.type)) {
      signals.push(state.signals.type);
    }
    return signals.length > 0 ? signals.join(" / ") : "未见明显代理信号";
  }
  function clamp$1(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function isAlertMeter(meter) {
    if (typeof meter.remaining === "number" && meter.remaining <= 0) {
      return true;
    }
    if (typeof meter.remainingPercent === "number" && meter.remainingPercent <= 5) {
      return true;
    }
    if (typeof meter.usedPercent === "number" && meter.usedPercent >= 95) {
      return true;
    }
    return false;
  }
  function chatGptMeterPriority(meter) {
    const key = meter.key.toLowerCase();
    const label = meter.label.toLowerCase();
    if (key.startsWith("limits_progress:file_upload")) {
      return 10;
    }
    if (key.startsWith("limits_progress:") || meter.rawKind === "limits_progress") {
      return 20;
    }
    if (label.includes("primary window")) {
      return 40;
    }
    if (label.includes("weekly window")) {
      return 41;
    }
    if (label.includes("credits")) {
      return 42;
    }
    if (key.includes("codex") || meter.rawKind === "codex.settings.usage") {
      return 50;
    }
    return 80;
  }
  function groupChatGptMeters(meters) {
    const groups = {
      input: [],
      features: [],
      windows: [],
      codex: [],
      other: []
    };
    for (const meter of meters) {
      groups[chatGptMeterSection(meter)].push(meter);
    }
    return GPT_SECTION_ORDER.map((key) => ({
      label: GPT_SECTION_LABELS[key],
      meters: groups[key]
    })).filter((section) => section.meters.length > 0);
  }
  function chatGptMeterSection(meter) {
    const key = meter.key.toLowerCase();
    const rawKind = meter.rawKind?.toLowerCase() ?? "";
    const label = meter.label.toLowerCase();
    if (key.includes("codex") || rawKind === "codex.settings.usage" || rawKind === "credits" || key === "wham:credits") {
      return "codex";
    }
    if (key.startsWith("wham:") || key.startsWith("tasks:") || rawKind.includes("rate_limit") || rawKind.includes("window")) {
      return "windows";
    }
    if (rawKind === "limits_progress" || key.startsWith("limits_progress:")) {
      return isInputOrAttachmentMeter(key, label) ? "input" : "features";
    }
    return "other";
  }
  function isInputOrAttachmentMeter(key, label) {
    return key.includes("file_upload") || key.includes("paste_text") || key.includes("dictation") || key.includes("upload") || label.includes("file upload") || label.includes("paste text") || label.includes("dictation");
  }
  function grokMeterPriority(meter) {
    if (meter.rawKind === "queries") {
      return 10;
    }
    if (meter.rawKind === "highEffortRateLimits") {
      return 20;
    }
    if (meter.rawKind === "lowEffortRateLimits") {
      return 30;
    }
    if (meter.rawKind === "tokens") {
      return 40;
    }
    return 80;
  }
  function shortLabel(label) {
    return label.replace(/\bwindow\b/gi, "").replace(/\s+/g, " ").trim().slice(0, 18);
  }
  function modelSummaryFromMeter(meter) {
    if (!meter.modelName) {
      return null;
    }
    if (meter.requestKind && meter.requestKind !== "DEFAULT") {
      return `${meter.modelName} · ${meter.requestKind}`;
    }
    return meter.modelName;
  }
  function assetUrl(name) {
    const path = `assets/nahida/${name}`;
    if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
      return chrome.runtime.getURL(path);
    }
    return path;
  }
  function decorativeAsset(name, className) {
    const image = document.createElement("img");
    image.className = className;
    image.src = assetUrl(name);
    image.alt = "";
    image.decoding = "async";
    image.draggable = false;
    image.setAttribute("aria-hidden", "true");
    return image;
  }
  function titleNode(className, label, assetName) {
    const title = el("div", className);
    title.append(
      decorativeAsset(assetName, "title-icon"),
      textEl("span", "title-text", label)
    );
    return title;
  }
  function sectionTitle(label, assetName) {
    const title = el("div", "meter-section-title");
    title.append(
      decorativeAsset(assetName, "section-title-icon"),
      textEl("span", "section-title-text", label)
    );
    return title;
  }
  function iconText(tagName, className, assetName, label) {
    const element = el(tagName, className);
    element.append(decorativeAsset(assetName, "inline-icon"), document.createTextNode(label));
    return element;
  }
  function panelCorners(className) {
    const frame = el("div", className);
    frame.append(
      decorativeAsset("corner-top-left.png", "corner corner-top-left"),
      decorativeAsset("corner-top-right.png", "corner corner-top-right"),
      decorativeAsset("corner-bottom-left.png", "corner corner-bottom-left"),
      decorativeAsset("corner-bottom-right.png", "corner corner-bottom-right")
    );
    frame.setAttribute("aria-hidden", "true");
    return frame;
  }
  function cardCorners() {
    const frame = el("div", "card-corners");
    frame.append(
      decorativeAsset("corner-top-left.png", "card-corner card-corner-top-left"),
      decorativeAsset("corner-bottom-right.png", "card-corner card-corner-bottom-right")
    );
    frame.setAttribute("aria-hidden", "true");
    return frame;
  }
  function vineDivider() {
    const divider = el("div", "vine-divider");
    divider.append(decorativeAsset("divider-vine.png", "vine-divider-image"));
    divider.setAttribute("aria-hidden", "true");
    return divider;
  }
  function platformTitleAsset(platform2) {
    if (platform2 === "chatgpt") {
      return "clover-medallion.png";
    }
    if (platform2 === "claude") {
      return "leaf-emblem.png";
    }
    return "leaf-small.png";
  }
  function unique(values) {
    return Array.from(new Set(values));
  }
  function el(tagName, className) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    return element;
  }
  function textEl(tagName, className, text) {
    const element = el(tagName, className);
    element.textContent = text;
    return element;
  }
  function node(tagName, className, children) {
    const element = el(tagName, className);
    element.append(...children);
    return element;
  }
  function emptyNode() {
    return document.createElement("span");
  }
  function detectPlatform(location) {
    const hostname = location.hostname.toLowerCase();
    if (hostname === "grok.com" || hostname.endsWith(".grok.com")) {
      return "grok";
    }
    if (hostname === "claude.ai" || hostname.endsWith(".claude.ai")) {
      return "claude";
    }
    if (hostname === "chatgpt.com" || hostname.endsWith(".chatgpt.com")) {
      return "chatgpt";
    }
    return null;
  }
  function usageErrorFromBridge(response) {
    const status = response.error?.status;
    if (status === 401 || status === 403) {
      return {
        code: "UNAUTHORIZED",
        message: "未授权或当前页面无法读取",
        status
      };
    }
    if (status === 429) {
      return {
        code: "RATE_LIMITED",
        message: "接口限流，稍后手动刷新",
        status
      };
    }
    if (typeof status === "number" && status >= 500) {
      return {
        code: "NETWORK_ERROR",
        message: "平台接口暂时不可用",
        status
      };
    }
    return {
      code: "UNKNOWN",
      message: response.error?.message ?? "Unknown usage fetch error",
      status
    };
  }
  function formatUsageError(error, endpoint) {
    const prefix = endpoint ? `${endpoint}: ` : "";
    const status = error.status ? `${error.status} ` : "";
    return `${prefix}${status}${error.message}`;
  }
  const FEATURE_LABELS = {
    deep_research: "Deep Research",
    image_gen: "Image Generation",
    file_upload: "File Upload",
    odyssey: "Odyssey"
  };
  function normalizeChatGptConversationInit(json, source = "api") {
    const root = asRecord(json);
    if (!root) {
      return { meters: [], blockedFeatures: [] };
    }
    const meters = [];
    for (const item of getArray(root, "limits_progress")) {
      const record = asRecord(item);
      if (!record) {
        continue;
      }
      const featureName = getString(record, "feature_name") ?? "unknown_feature";
      const remaining = getNumber(record, "remaining");
      const resetAfter = record.reset_after;
      const resetAt = typeof resetAfter === "string" || typeof resetAfter === "number" ? resetAfter : null;
      meters.push({
        key: `limits_progress:${featureName}`,
        label: FEATURE_LABELS[featureName] ?? titleFromKey(featureName),
        remaining,
        resetAt,
        source,
        confidence: remaining !== null && resetAt !== null ? "high" : "medium",
        rawKind: "limits_progress"
      });
    }
    const defaultModelSlug = getString(root, "default_model_slug") ?? void 0;
    const blockedFeatures = asArray(root.blocked_features).map((item) => typeof item === "string" ? item : null).filter((item) => item !== null);
    return { meters, defaultModelSlug, blockedFeatures };
  }
  function normalizeWindowMeter(args) {
    const explicitRemainingPercent = percentFromRatioOrPercent(
      numberFromKeys(args.record, [
        "remaining_percent",
        "remainingPercent",
        "percent_remaining",
        "percentRemaining",
        "remaining_percentage",
        "remainingPercentage",
        "remaining_pct",
        "remainingPct"
      ])
    );
    const rawUsedPercent = percentFromRatioOrPercent(
      numberFromKeys(args.record, [
        "used_percent",
        "usedPercent",
        "used_percentage",
        "usedPercentage",
        "percent_used",
        "percentUsed",
        "utilization"
      ])
    );
    const remainingPercent = explicitRemainingPercent ?? (args.displayAsRemaining && rawUsedPercent !== null ? percentFromRatioOrPercent(100 - rawUsedPercent) : null);
    const usedPercent = remainingPercent !== null ? percentFromRatioOrPercent(100 - remainingPercent) : rawUsedPercent;
    const resetValue = resetValueFromRecord(args.record);
    const windowSeconds = numberFromKeys(args.record, [
      "limit_window_seconds",
      "limitWindowSeconds",
      "window_seconds",
      "windowSeconds",
      "window_size_seconds",
      "windowSizeSeconds"
    ]);
    if (usedPercent === null && remainingPercent === null && resetValue === null && windowSeconds === null) {
      return null;
    }
    return {
      key: args.key,
      label: args.label,
      usedPercent,
      remainingPercent,
      resetAt: resetValue,
      windowSeconds,
      source: args.source,
      confidence: usedPercent !== null && resetValue !== null ? "high" : "medium",
      rawKind: args.rawKind
    };
  }
  function normalizeChatGptWhamUsage(json, source = "api") {
    const root = asRecord(json);
    if (!root) {
      return [];
    }
    const meters = [];
    const rateLimit = getRecord(root, "rate_limit");
    if (rateLimit) {
      const primary = getRecord(rateLimit, "primary_window");
      if (primary) {
        const meter = normalizeWindowMeter({
          key: "wham:primary_window",
          label: "Primary window",
          record: primary,
          source,
          rawKind: "rate_limit.primary_window",
          displayAsRemaining: true
        });
        if (meter) {
          meters.push(meter);
        }
      }
      const secondary = getRecord(rateLimit, "secondary_window");
      if (secondary) {
        const meter = normalizeWindowMeter({
          key: "wham:secondary_window",
          label: "Weekly window",
          record: secondary,
          source,
          rawKind: "rate_limit.secondary_window",
          displayAsRemaining: true
        });
        if (meter) {
          meters.push(meter);
        }
      }
    }
    const codeReviewRateLimit = getRecord(root, "code_review_rate_limit");
    const codeReviewPrimary = codeReviewRateLimit ? getRecord(codeReviewRateLimit, "primary_window") : null;
    if (codeReviewPrimary) {
      const meter = normalizeWindowMeter({
        key: "wham:code_review",
        label: "Code Review",
        record: codeReviewPrimary,
        source,
        rawKind: "code_review_rate_limit.primary_window",
        displayAsRemaining: true
      });
      if (meter) {
        meters.push(meter);
      }
    }
    const credits = getRecord(root, "credits");
    if (credits) {
      const unlimited = asBoolean(credits.unlimited);
      const balance = getNumber(credits, "balance");
      if (unlimited !== null || balance !== null || asBoolean(credits.has_credits) !== null) {
        meters.push({
          key: "wham:credits",
          label: unlimited ? "Credits (unlimited)" : "Credits",
          remaining: balance,
          source,
          confidence: balance !== null || unlimited === true ? "medium" : "low",
          rawKind: "credits"
        });
      }
    }
    meters.push(...normalizeAdditionalWhamUsageWindows(root, source));
    meters.push(...normalizeWhamCodexNamedUsage(root, source));
    return dedupeMeters(meters);
  }
  function normalizeAdditionalWhamUsageWindows(root, source) {
    const knownPaths = /* @__PURE__ */ new Set([
      "root.rate_limit.primary_window",
      "root.rate_limit.secondary_window",
      "root.code_review_rate_limit.primary_window",
      "root.credits"
    ]);
    return collectUsageCandidates(root, "root", {
      maxDepth: 7,
      includeRecord: (path, record) => !knownPaths.has(path) && isGeneralChatGptUsageLike(path, record)
    }).map(
      (candidate) => normalizeGenericUsageObject(candidate.path, candidate.record, source, {
        keyPrefix: "wham",
        rawKind: "chatgpt.usage.window",
        displayAsRemaining: true
      })
    ).filter((meter) => meter !== null);
  }
  function normalizeWhamCodexNamedUsage(root, source) {
    const codexRoots = collectCodexNamedSubtrees(root);
    const meters = [];
    const seen = /* @__PURE__ */ new Set();
    for (const item of codexRoots) {
      for (const meter of normalizeCodexUsageRecordTree(
        item.record,
        `wham.${item.path}`,
        source
      )) {
        if (seen.has(meter.key)) {
          continue;
        }
        seen.add(meter.key);
        meters.push(meter);
      }
    }
    return meters;
  }
  function collectCodexNamedSubtrees(root) {
    const queue = [
      { path: "root", value: root, depth: 0 }
    ];
    const matches = [];
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item || item.depth > 4) {
        continue;
      }
      const record = asRecord(item.value);
      if (!record) {
        continue;
      }
      for (const [key, value] of Object.entries(record)) {
        const path = `${item.path}.${key}`;
        const childRecord = asRecord(value);
        if (childRecord) {
          if (isCodexPath(path)) {
            matches.push({ path, record: childRecord });
          }
          queue.push({ path, value, depth: item.depth + 1 });
        } else if (Array.isArray(value)) {
          value.forEach((entry, index) => {
            queue.push({
              path: `${path}.${index}`,
              value: entry,
              depth: item.depth + 1
            });
          });
        }
      }
    }
    return matches;
  }
  function isCodexPath(path) {
    const normalized = path.toLowerCase();
    return normalized.includes("codex") && !normalized.includes("code_review");
  }
  function normalizeTasksRateLimit(json, source = "api") {
    const root = asRecord(json);
    if (!root) {
      return [];
    }
    const meters = [];
    const direct = normalizeWindowMeter({
      key: "tasks:rate_limit",
      label: "Tasks rate limit",
      record: root,
      source,
      rawKind: "tasks.rate_limit"
    });
    if (direct) {
      meters.push(direct);
    }
    return meters;
  }
  function normalizeChatGptCodexSettingsUsage(json, source = "api") {
    const root = asRecord(json);
    if (!root) {
      return [];
    }
    return normalizeCodexUsageRecordTree(root, "codex", source);
  }
  function normalizeCodexUsageRecordTree(root, rootPath, source) {
    const candidates = collectCodexUsageCandidates(root, rootPath);
    const meters = [];
    const seen = /* @__PURE__ */ new Set();
    for (const candidate of candidates) {
      const meter = normalizeCodexUsageObject(candidate.path, candidate.record, source);
      if (!meter || seen.has(meter.key)) {
        continue;
      }
      seen.add(meter.key);
      meters.push(meter);
    }
    return meters;
  }
  function collectCodexUsageCandidates(root, rootPath) {
    return collectUsageCandidates(root, rootPath, {
      maxDepth: 7,
      includeRecord: (_path, record) => isCodexUsageLike(record)
    });
  }
  function isCodexUsageLike(record) {
    return numberFromKeys(record, ["remaining", "remaining_credits", "remainingCredits"]) !== null || numberFromKeys(record, ["total", "limit", "quota", "total_credits", "totalCredits"]) !== null || numberFromKeys(record, ["used", "usage", "used_credits", "usedCredits"]) !== null || numberFromKeys(record, ["used_percent", "usedPercent", "utilization"]) !== null || numberFromKeys(record, [
      "remaining_percent",
      "remainingPercent",
      "percent_remaining",
      "percentRemaining",
      "remaining_percentage",
      "remainingPercentage"
    ]) !== null || numberFromKeys(record, ["reset_after", "resetAfter", "reset_after_seconds"]) !== null || stringOrNumberFromKeys(record, ["reset_at", "resetAt", "resets_at"]) !== null;
  }
  function isGeneralChatGptUsageLike(path, record) {
    if (isCodexPath(path)) {
      return false;
    }
    if (!isCodexUsageLike(record)) {
      return false;
    }
    const normalizedPath = path.toLowerCase();
    const label = usageLabel(record, path).toLowerCase();
    const hasUsageNameSignal = normalizedPath.includes("limit") || normalizedPath.includes("window") || normalizedPath.includes("usage") || normalizedPath.includes("quota") || normalizedPath.includes("bucket") || label.includes("limit") || label.includes("window") || label.includes("usage") || label.includes("额度") || label.includes("使用限额");
    const hasCountQuotaSignal = numberFromKeys(record, ["remaining", "remaining_credits", "remainingCredits"]) !== null && numberFromKeys(record, [
      "total",
      "limit",
      "quota",
      "total_credits",
      "totalCredits"
    ]) !== null;
    const hasCurrentWindowSignal = hasCountQuotaSignal || numberFromKeys(record, [
      "remaining_percent",
      "remainingPercent",
      "percent_remaining",
      "percentRemaining",
      "remaining_percentage",
      "remainingPercentage",
      "remaining_pct",
      "remainingPct",
      "used_percent",
      "usedPercent",
      "used_percentage",
      "usedPercentage",
      "percent_used",
      "percentUsed",
      "utilization"
    ]) !== null || resetValueFromRecord(record) !== null || numberFromKeys(record, [
      "reset_after",
      "resetAfter",
      "reset_after_seconds",
      "limit_window_seconds",
      "limitWindowSeconds",
      "window_seconds",
      "windowSeconds",
      "window_size_seconds",
      "windowSizeSeconds"
    ]) !== null;
    return hasUsageNameSignal && hasCurrentWindowSignal;
  }
  function normalizeCodexUsageObject(path, record, source) {
    return normalizeGenericUsageObject(path, record, source, {
      keyPrefix: "codex",
      rawKind: "codex.settings.usage",
      displayAsRemaining: true
    });
  }
  function normalizeGenericUsageObject(path, record, source, options) {
    const remaining = numberFromKeys(record, [
      "remaining",
      "remaining_credits",
      "remainingCredits"
    ]);
    const total = numberFromKeys(record, [
      "total",
      "limit",
      "quota",
      "total_credits",
      "totalCredits"
    ]);
    const used = numberFromKeys(record, ["used", "usage", "used_credits", "usedCredits"]) ?? (remaining !== null && total !== null ? Math.max(0, total - remaining) : null);
    const explicitRemainingPercent = percentFromRatioOrPercent(
      numberFromKeys(record, [
        "remaining_percent",
        "remainingPercent",
        "percent_remaining",
        "percentRemaining",
        "remaining_percentage",
        "remainingPercentage",
        "remaining_pct",
        "remainingPct"
      ])
    );
    const rawUsedPercent = percentFromRatioOrPercent(
      numberFromKeys(record, [
        "used_percent",
        "usedPercent",
        "used_percentage",
        "usedPercentage",
        "percent_used",
        "percentUsed",
        "utilization"
      ])
    );
    const remainingPercent = explicitRemainingPercent ?? (options.displayAsRemaining && rawUsedPercent !== null ? percentFromRatioOrPercent(100 - rawUsedPercent) : null);
    const usedPercent = remainingPercent !== null ? percentFromRatioOrPercent(100 - remainingPercent) : rawUsedPercent;
    const resetAt = resetValueFromRecord(record);
    const resetAfterSeconds = numberFromKeys(record, [
      "reset_after",
      "resetAfter",
      "reset_after_seconds"
    ]);
    const windowSeconds = numberFromKeys(record, [
      "limit_window_seconds",
      "limitWindowSeconds",
      "window_seconds",
      "windowSeconds",
      "window_size_seconds",
      "windowSizeSeconds"
    ]);
    const label = usageLabel(record, path);
    if (remaining === null && total === null && used === null && usedPercent === null && remainingPercent === null && resetAt === null && resetAfterSeconds === null && windowSeconds === null) {
      return null;
    }
    return {
      key: `${options.keyPrefix}:${path}`,
      label,
      remaining,
      total,
      used,
      usedPercent: usedPercent ?? (used !== null && total !== null && total > 0 ? percentFromRatioOrPercent(used / total) : null),
      remainingPercent: remainingPercent ?? (remaining !== null && total !== null && total > 0 ? percentFromRatioOrPercent(remaining / total) : null),
      resetAt,
      resetAfterSeconds,
      windowSeconds,
      source,
      confidence: remaining !== null || total !== null || usedPercent !== null || remainingPercent !== null ? "medium" : "low",
      rawKind: options.rawKind
    };
  }
  function collectUsageCandidates(root, rootPath, options) {
    const queue = [
      { path: rootPath, value: root, depth: 0 }
    ];
    const candidates = [];
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item || item.depth > options.maxDepth) {
        continue;
      }
      const record = asRecord(item.value);
      if (!record) {
        continue;
      }
      if (options.includeRecord(item.path, record)) {
        candidates.push({ path: item.path, record });
      }
      for (const [key, value] of Object.entries(record)) {
        if (Array.isArray(value)) {
          value.forEach((entry, index) => {
            queue.push({
              path: `${item.path}.${key}.${index}`,
              value: entry,
              depth: item.depth + 1
            });
          });
        } else if (asRecord(value)) {
          queue.push({
            path: `${item.path}.${key}`,
            value,
            depth: item.depth + 1
          });
        }
      }
    }
    return candidates;
  }
  function usageLabel(record, path) {
    const direct = getString(record, "label") ?? getString(record, "title") ?? getString(record, "name") ?? getString(record, "display_name") ?? getString(record, "displayName") ?? getString(record, "feature_name") ?? getString(record, "bucket_name") ?? getString(record, "bucketName") ?? getString(record, "limit_name") ?? getString(record, "limitName");
    if (direct) {
      const titled = displayUsageLabel(direct);
      if (path.toLowerCase().includes("codex") && isSimpleUsageKey(direct) && !/codex|gpt/i.test(titled)) {
        return `Codex ${titled}`;
      }
      return titled;
    }
    const model = getString(record, "model") ?? getString(record, "model_name") ?? getString(record, "modelName") ?? getString(record, "model_slug") ?? getString(record, "modelSlug");
    const windowName = getString(record, "window") ?? getString(record, "window_name") ?? getString(record, "windowName") ?? getString(record, "period") ?? getString(record, "period_name") ?? getString(record, "periodName");
    if (model && windowName) {
      return `${model} ${titleFromKey(windowName)} 使用限额`;
    }
    if (model) {
      return `${model} 使用限额`;
    }
    const normalizedPath = path.toLowerCase();
    if (normalizedPath === "codex" || normalizedPath.includes("codex_usage")) {
      return "Codex usage";
    }
    const pathLabel = path.split(".").filter((part) => part !== "root" && !/^\d+$/.test(part)).slice(-3).join(" ");
    return pathLabel ? titleFromKey(pathLabel) : "Codex usage";
  }
  function displayUsageLabel(value) {
    const trimmed = value.trim();
    if (!isSimpleUsageKey(trimmed)) {
      return trimmed;
    }
    return titleFromKey(trimmed);
  }
  function isSimpleUsageKey(value) {
    return /^[A-Za-z0-9_]+$/.test(value.trim());
  }
  function resetValueFromRecord(record) {
    return stringOrNumberFromKeys(record, [
      "reset_at",
      "resetAt",
      "resets_at",
      "resetsAt",
      "reset_time",
      "resetTime",
      "resets"
    ]);
  }
  function dedupeMeters(meters) {
    const seen = /* @__PURE__ */ new Set();
    const result = [];
    for (const meter of meters) {
      if (seen.has(meter.key)) {
        continue;
      }
      seen.add(meter.key);
      result.push(meter);
    }
    return result;
  }
  function numberFromKeys(record, keys) {
    for (const key of keys) {
      const value = getNumber(record, key);
      if (value !== null) {
        return value;
      }
    }
    return null;
  }
  function stringOrNumberFromKeys(record, keys) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" || typeof value === "number") {
        return value;
      }
    }
    return null;
  }
  function responseFailure$2(response) {
    return formatUsageError(
      usageErrorFromBridge(response),
      response.endpointKey ?? "chatgpt"
    );
  }
  async function fetchChatGptUsage(fetcher) {
    const meters = [];
    const requiredFailures = [];
    const optionalFailures = [];
    let defaultModelSlug;
    let blockedFeatures = [];
    const conversation = await fetcher("chatgpt:conversationInit");
    if (conversation.ok) {
      const normalized = normalizeChatGptConversationInit(conversation.json, "api");
      meters.push(...normalized.meters);
      defaultModelSlug = normalized.defaultModelSlug;
      blockedFeatures = normalized.blockedFeatures;
    } else {
      requiredFailures.push(responseFailure$2(conversation));
    }
    const wham = await fetcher("chatgpt:whamUsage");
    if (wham.ok) {
      meters.push(...normalizeChatGptWhamUsage(wham.json, "api"));
    } else {
      optionalFailures.push(responseFailure$2(wham));
    }
    const tasks = await fetcher("chatgpt:whamTasksRateLimit");
    if (tasks.ok) {
      meters.push(...normalizeTasksRateLimit(tasks.json, "api"));
    } else {
      optionalFailures.push(responseFailure$2(tasks));
    }
    const codexUsage = await fetcher("chatgpt:codexSettingsUsage");
    if (codexUsage.ok) {
      meters.push(...normalizeChatGptCodexSettingsUsage(codexUsage.json, "api"));
    } else {
      optionalFailures.push(responseFailure$2(codexUsage));
    }
    const hasBlocking = blockedFeatures.length > 0;
    const hasOptionalFailures = optionalFailures.length > 0;
    const firstFailure = requiredFailures[0] ?? optionalFailures[0];
    return {
      platform: "chatgpt",
      meters,
      source: meters.length > 0 ? "api" : "unknown",
      updatedAt: Date.now(),
      status: meters.length > 0 ? hasOptionalFailures || hasBlocking ? "partial" : "ok" : firstFailure ? "error" : "unknown",
      errorMessage: hasBlocking ? "部分功能被限制" : meters.length === 0 && firstFailure ? firstFailure : void 0,
      debug: {
        endpoint: "chatgpt:conversationInit,chatgpt:whamUsage,chatgpt:codexSettingsUsage",
        parser: defaultModelSlug ? `chatgpt.default_model=${defaultModelSlug}` : "chatgpt"
      }
    };
  }
  function normalizeChatGptIntercepted(url, json) {
    const path = safePathname(url);
    if (path === "/backend-api/conversation/init") {
      return normalizeChatGptConversationInit(json, "intercepted").meters;
    }
    if (path === "/backend-api/wham/usage") {
      return normalizeChatGptWhamUsage(json, "intercepted");
    }
    if (path === "/backend-api/wham/tasks/rate_limit") {
      return normalizeTasksRateLimit(json, "intercepted");
    }
    if (path === "/codex/settings/usage") {
      return normalizeChatGptCodexSettingsUsage(json, "intercepted");
    }
    return [];
  }
  function safePathname(url) {
    try {
      return new URL(url).pathname;
    } catch {
      return "";
    }
  }
  const FRIENDLY_LABELS = {
    five_hour: "5h",
    seven_day: "7d all models",
    seven_day_sonnet: "7d Sonnet",
    seven_day_opus: "7d Opus",
    seven_day_omelette: "7d Design / Omelette",
    extra_usage: "Extra Usage"
  };
  function extractClaudeOrgId(json) {
    const root = asRecord(json);
    const candidates = Array.isArray(json) ? json : root ? asArray(root.organizations) : [];
    for (const item of candidates) {
      const record = asRecord(item);
      if (!record) {
        continue;
      }
      const uuid = getString(record, "uuid");
      const id = getString(record, "id");
      if (uuid) {
        return uuid;
      }
      if (id) {
        return id;
      }
    }
    return null;
  }
  function isUsageLike(record) {
    return "utilization" in record || "used_percentage" in record || "used_credits" in record || "monthly_limit" in record;
  }
  function normalizeUsageObject(key, record, source) {
    if (!isUsageLike(record)) {
      return null;
    }
    const utilization = getNumber(record, "utilization") ?? getNumber(record, "used_percentage");
    const usedPercent = percentFromRatioOrPercent(utilization);
    const resetAt = getString(record, "resets_at");
    const total = getNumber(record, "monthly_limit");
    const used = getNumber(record, "used_credits");
    const remaining = total !== null && used !== null ? Math.max(0, total - used) : null;
    const isEnabled = asBoolean(record.is_enabled);
    const hasAnyValue = usedPercent !== null || resetAt !== null || total !== null || used !== null || isEnabled !== null;
    if (!hasAnyValue) {
      return null;
    }
    return {
      key,
      label: FRIENDLY_LABELS[key] ?? titleFromKey(key),
      remaining,
      total,
      used,
      usedPercent,
      resetAt,
      source,
      confidence: usedPercent !== null && resetAt !== null ? "high" : usedPercent !== null || total !== null || used !== null ? "medium" : "low",
      rawKind: key
    };
  }
  function normalizeClaudeUsage(json, source = "api") {
    const root = asRecord(json);
    if (!root) {
      return [];
    }
    const meters = [];
    for (const [key, value] of Object.entries(root)) {
      const record = asRecord(value);
      if (!record) {
        continue;
      }
      const meter = normalizeUsageObject(key, record, source);
      if (meter) {
        meters.push(meter);
      }
    }
    return meters;
  }
  function responseFailure$1(response) {
    return formatUsageError(
      usageErrorFromBridge(response),
      response.endpointKey ?? "claude"
    );
  }
  async function fetchClaudeUsage(fetcher) {
    const organizations = await fetcher("claude:organizations");
    if (!organizations.ok) {
      return {
        platform: "claude",
        meters: [],
        source: "unknown",
        updatedAt: Date.now(),
        status: "error",
        errorMessage: responseFailure$1(organizations),
        debug: {
          endpoint: "claude:organizations",
          parser: "claude.organizations"
        }
      };
    }
    const orgId = extractClaudeOrgId(organizations.json);
    if (!orgId) {
      return {
        platform: "claude",
        meters: [],
        source: "unknown",
        updatedAt: Date.now(),
        status: "error",
        errorMessage: "No Claude organization id found",
        debug: {
          endpoint: "claude:organizations",
          parser: "claude.organizations"
        }
      };
    }
    const usage = await fetcher("claude:usage", { orgId });
    if (!usage.ok) {
      return {
        platform: "claude",
        meters: [],
        source: "unknown",
        updatedAt: Date.now(),
        status: "error",
        errorMessage: responseFailure$1(usage),
        debug: {
          endpoint: "claude:usage",
          parser: "claude.usage"
        }
      };
    }
    const meters = normalizeClaudeUsage(usage.json, "api");
    return {
      platform: "claude",
      meters,
      source: meters.length > 0 ? "api" : "unknown",
      updatedAt: Date.now(),
      status: meters.length > 0 ? "ok" : "unknown",
      debug: {
        endpoint: "claude:usage",
        parser: "claude.usage"
      }
    };
  }
  const GROK_ENDPOINT_KEY = "grok:rate-limits";
  const MAX_OBSERVED_CONTEXTS = 12;
  const DEFAULT_REQUEST_KIND = "DEFAULT";
  const observedContexts = /* @__PURE__ */ new Map();
  function makeMeter(args) {
    const explicitResetAfterSeconds = args.resetAfterSeconds ?? null;
    if (args.remaining === null && args.total === null && explicitResetAfterSeconds === null) {
      return null;
    }
    const used = args.remaining !== null && args.total !== null ? Math.max(0, args.total - args.remaining) : null;
    const usedPercent = used !== null && args.total !== null && args.total > 0 ? percentFromRatioOrPercent(used / args.total) : null;
    const confidence = args.remaining !== null && args.total !== null ? "high" : args.resetAfterSeconds !== null || args.windowSeconds !== null ? "medium" : "low";
    return {
      key: args.key,
      label: args.label,
      modelName: args.modelName,
      requestKind: args.requestKind,
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
  function normalizeGrokRateLimit(json, options = {}) {
    const record = asRecord(json);
    if (!record) {
      return [];
    }
    const source = options.source ?? "api";
    const modelName = getString(record, "modelName") ?? getString(record, "model") ?? getString(record, "modelId") ?? options.modelName ?? "unknown";
    const requestKind = getString(record, "requestKind") ?? getString(record, "kind") ?? options.requestKind ?? DEFAULT_REQUEST_KIND;
    const displayName = getString(record, "displayName") ?? getString(record, "modelDisplayName");
    const labelPrefix = options.labelPrefix ?? displayName ?? modelName;
    const meterKeyPrefix = grokMeterKeyPrefix(modelName, requestKind);
    const requestKindLabel = requestKind === DEFAULT_REQUEST_KIND ? "" : ` · ${requestKind}`;
    const windowSeconds = getNumber(record, "windowSizeSeconds");
    const meters = [];
    const queryMeter = makeMeter({
      key: `${meterKeyPrefix}:queries`,
      label: `${labelPrefix}${requestKindLabel} query limit`,
      modelName,
      requestKind,
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
      key: `${meterKeyPrefix}:tokens`,
      label: `${labelPrefix}${requestKindLabel} token limit`,
      modelName,
      requestKind,
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
        key: `${meterKeyPrefix}:low-effort`,
        label: `${labelPrefix}${requestKindLabel} Low / Fast / Normal`,
        modelName,
        requestKind,
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
        key: `${meterKeyPrefix}:high-effort`,
        label: `${labelPrefix}${requestKindLabel} High / Thinking / Expert`,
        modelName,
        requestKind,
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
  function grokRateLimitContextFromJson(json) {
    const record = asRecord(json);
    if (!record) {
      return void 0;
    }
    const modelName = getString(record, "modelName") ?? getString(record, "model") ?? getString(record, "modelId");
    const requestKind = getString(record, "requestKind") ?? getString(record, "kind");
    if (!modelName && !requestKind) {
      return void 0;
    }
    return {
      modelName: modelName ?? void 0,
      requestKind: requestKind ?? void 0
    };
  }
  function responseFailure(response) {
    return formatUsageError(
      usageErrorFromBridge(response),
      response.endpointKey ?? "grok"
    );
  }
  async function fetchGrokUsage(fetcher) {
    const meters = [];
    const failures = [];
    const latestContext = getLatestObservedGrokRateLimitContext();
    const contexts = latestContext ? [latestContext] : [];
    if (contexts.length === 0) {
      return {
        platform: "grok",
        meters,
        source: "unknown",
        updatedAt: Date.now(),
        status: "unknown",
        debug: {
          endpoint: GROK_ENDPOINT_KEY,
          parser: "grok.rateLimit.dynamic"
        }
      };
    }
    for (const context of contexts) {
      const response = await fetcher(GROK_ENDPOINT_KEY, {
        modelName: context.modelName,
        requestKind: context.requestKind ?? DEFAULT_REQUEST_KIND
      });
      if (!response.ok) {
        failures.push(responseFailure(response));
        continue;
      }
      meters.push(
        ...normalizeGrokRateLimit(response.json, {
          modelName: context.modelName,
          requestKind: context.requestKind,
          source: "api"
        })
      );
    }
    return {
      platform: "grok",
      meters,
      source: meters.length > 0 ? "api" : "unknown",
      updatedAt: Date.now(),
      status: meters.length > 0 ? failures.length > 0 ? "partial" : "ok" : failures.length > 0 ? "error" : "unknown",
      errorMessage: failures[0],
      debug: {
        endpoint: contexts.map(
          (context) => `${GROK_ENDPOINT_KEY}:${context.modelName}:${context.requestKind ?? DEFAULT_REQUEST_KIND}`
        ).join(","),
        parser: "grok.rateLimit.dynamic"
      }
    };
  }
  function rememberGrokRateLimitContext(context) {
    if (!context?.modelName || !isSafeGrokModelName(context.modelName)) {
      return;
    }
    const requestKind = isSafeGrokRequestKind(context.requestKind) ? context.requestKind : DEFAULT_REQUEST_KIND;
    const normalized = {
      modelName: context.modelName,
      requestKind
    };
    const key = contextKey(normalized);
    observedContexts.delete(key);
    observedContexts.set(key, normalized);
    while (observedContexts.size > MAX_OBSERVED_CONTEXTS) {
      const oldestKey = observedContexts.keys().next().value;
      if (!oldestKey) {
        break;
      }
      observedContexts.delete(oldestKey);
    }
  }
  function getObservedGrokRateLimitContexts() {
    return [...observedContexts.values()];
  }
  function getLatestObservedGrokRateLimitContext() {
    const contexts = getObservedGrokRateLimitContexts();
    return contexts[contexts.length - 1];
  }
  function grokMeterKeyPrefix(modelName, requestKind) {
    return `${modelName}:${requestKind.toLowerCase()}`;
  }
  function contextKey(context) {
    return grokMeterKeyPrefix(
      context.modelName,
      context.requestKind ?? DEFAULT_REQUEST_KIND
    );
  }
  function isSafeGrokModelName(value) {
    return /^[A-Za-z0-9._:-]{1,120}$/.test(value);
  }
  function isSafeGrokRequestKind(value) {
    return value !== void 0 && /^[A-Z_]{1,40}$/.test(value);
  }
  function fetchPlatformUsage(platform2, fetcher) {
    if (platform2 === "grok") {
      return fetchGrokUsage(fetcher);
    }
    if (platform2 === "claude") {
      return fetchClaudeUsage(fetcher);
    }
    return fetchChatGptUsage(fetcher);
  }
  function normalizeInterceptedUsage(args) {
    const meters = normalizeInterceptedMeters(args);
    return {
      platform: args.platform,
      meters,
      source: meters.length > 0 ? "intercepted" : "unknown",
      updatedAt: args.ts,
      status: meters.length > 0 ? "ok" : "unknown",
      debug: {
        endpoint: args.url,
        parser: `${args.platform}.intercepted`
      }
    };
  }
  function normalizeInterceptedMeters(args) {
    if (args.platform === "grok") {
      const usageContext = args.usageContext ?? grokRateLimitContextFromJson(args.json);
      rememberGrokRateLimitContext(usageContext);
      return normalizeGrokRateLimit(args.json, {
        modelName: usageContext?.modelName,
        requestKind: usageContext?.requestKind,
        source: "intercepted"
      });
    }
    if (args.platform === "claude") {
      return normalizeClaudeUsage(args.json, "intercepted");
    }
    return normalizeChatGptIntercepted(args.url, args.json);
  }
  const MERGED_METER_TTL_MS = 30 * 6e4;
  function mergeUsageSnapshots(existing, incoming, now = Date.now()) {
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
  function withObservedAt(snapshot, fallbackObservedAt) {
    return {
      ...snapshot,
      meters: snapshot.meters.map((meter) => ({
        ...meter,
        observedAt: meter.observedAt ?? fallbackObservedAt
      }))
    };
  }
  function mergedStatus(existing, incoming, meterCount) {
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
  function mergedErrorMessage(existing, incoming, meterCount) {
    if (meterCount === 0) {
      return incoming.errorMessage ?? existing.errorMessage;
    }
    if (incoming.errorMessage === "部分功能被限制") {
      return incoming.errorMessage;
    }
    return void 0;
  }
  function joinDebugField(existing, incoming) {
    const values = [existing, incoming].filter(
      (value) => Boolean(value)
    );
    if (values.length === 0) {
      return void 0;
    }
    return Array.from(new Set(values.flatMap((value) => value.split(",")))).join(",");
  }
  const CHATGPT_SENTINEL_EVENT = "__AIQM_SENTINEL_EVENT__";
  function sanitizeSentinelObservation(value) {
    const record = asRecord(value);
    if (!record || record.source !== "chatgpt-sentinel") {
      return null;
    }
    const urlKind = record.urlKind;
    if (urlKind !== "chat-requirements" && urlKind !== "prepare") {
      return null;
    }
    const ts = getNumber(record, "ts");
    if (ts === null) {
      return null;
    }
    const powDifficulty = getString(record, "powDifficulty");
    return {
      source: "chatgpt-sentinel",
      ts,
      urlKind,
      powRequired: asBoolean(record.powRequired) === true,
      powDifficulty
    };
  }
  function parsePowRisk(difficulty) {
    if (!difficulty || typeof difficulty !== "string") {
      return {
        raw: null,
        clean: null,
        len: null,
        decimal: null,
        level: "Unknown",
        risk: 0
      };
    }
    const clean = difficulty.replace(/^0x/i, "").replace(/^0+/, "") || "0";
    const len = clean.length;
    const parsed = Number.parseInt(clean, 16);
    const decimal = Number.isFinite(parsed) ? parsed : null;
    if (len <= 2) {
      return { raw: difficulty, clean, len, decimal, level: "Critical", risk: 100 };
    }
    if (len <= 3) {
      return { raw: difficulty, clean, len, decimal, level: "Hard", risk: 75 };
    }
    if (len <= 4) {
      return { raw: difficulty, clean, len, decimal, level: "Medium", risk: 50 };
    }
    if (len <= 5) {
      return { raw: difficulty, clean, len, decimal, level: "Easy", risk: 25 };
    }
    return { raw: difficulty, clean, len, decimal, level: "Very Easy", risk: 0 };
  }
  function computeSentinelRisk(obs) {
    const pow = parsePowRisk(obs.powDifficulty);
    const powRequiredWithoutDifficulty = obs.powRequired === true && !obs.powDifficulty;
    const score = clamp(
      pow.risk + 10 * Number(powRequiredWithoutDifficulty)
    );
    const label = score >= 75 ? "严重" : score >= 50 ? "高" : score >= 25 ? "偏高" : "正常";
    return {
      score,
      label,
      pow,
      factors: {
        powRequired: obs.powRequired,
        powRequiredWithoutDifficulty
      }
    };
  }
  function toChatGPTSentinelState(obs) {
    const sentinel = computeSentinelRisk(obs);
    return {
      updatedAt: obs.ts,
      sentinelRisk: {
        score: sentinel.score,
        label: sentinel.label
      },
      pow: sentinel.pow,
      gates: {
        powRequired: obs.powRequired
      },
      explanation: "当前仅验证 PoW 难度，不判断模型 fallback。"
    };
  }
  function containsForbiddenSentinelKey(value) {
    const queue = [value];
    while (queue.length > 0) {
      const current = queue.shift();
      const record = asRecord(current);
      if (!record) {
        if (Array.isArray(current)) {
          queue.push(...current);
        }
        continue;
      }
      for (const [key, child] of Object.entries(record)) {
        if (isForbiddenSentinelKey(key)) {
          return true;
        }
        queue.push(child);
      }
    }
    return false;
  }
  function isForbiddenSentinelKey(key) {
    const normalized = key.toLowerCase();
    return normalized === "token" || normalized === "prepare_token" || normalized === "dx" || normalized === "collector_dx" || normalized === "seed" || normalized === "cookie" || normalized === "authorization" || normalized.startsWith("oai-") || normalized.startsWith("x-oai-");
  }
  function clamp(n, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Math.round(n)));
  }
  const IP_RISK_AUTO_REFRESH_MS = 24 * 60 * 60 * 1e3;
  const DEFAULT_IP_RISK_PUBLIC_SETTINGS = {
    enabled: false
  };
  function disabledIpRiskState(now = Date.now()) {
    return {
      provider: "proxycheck",
      source: "proxycheck.io",
      status: "disabled",
      updatedAt: now,
      score: null,
      label: "未知",
      signals: emptySignals()
    };
  }
  function missingKeyIpRiskState(now = Date.now()) {
    return {
      provider: "proxycheck",
      source: "proxycheck.io",
      status: "missing-key",
      updatedAt: now,
      score: null,
      label: "未知",
      signals: emptySignals()
    };
  }
  function sanitizeProxycheckApiKey(value) {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 512) {
      return null;
    }
    return trimmed;
  }
  function publicIpRiskSettings(settings) {
    return {
      provider: "proxycheck",
      enabled: settings.enabled,
      hasApiKey: Boolean(settings.proxycheckApiKey),
      apiKeyPreview: maskProxycheckApiKey(settings.proxycheckApiKey)
    };
  }
  function maskProxycheckApiKey(value) {
    const apiKey = sanitizeProxycheckApiKey(value);
    if (!apiKey) {
      return null;
    }
    if (apiKey.length <= 4) {
      return "••••";
    }
    const suffix = apiKey.slice(-4);
    const hiddenLength = Math.min(Math.max(apiKey.length - 4, 6), 14);
    return `${"•".repeat(hiddenLength)}${suffix}`;
  }
  function emptySignals() {
    return {
      proxy: false,
      vpn: false,
      tor: false,
      hosting: false,
      type: null
    };
  }
  const OBSERVATION_LIMIT = 20;
  const STATE_KEY = "aiUsage:chatgpt:sentinelState";
  const OBSERVATIONS_KEY = "aiUsage:chatgpt:sentinelObservations";
  async function getChatGptSentinelState() {
    const items = await storageGet$1(STATE_KEY);
    const value = items[STATE_KEY];
    return isChatGptSentinelState(value) ? value : null;
  }
  async function rememberChatGptSentinelObservation(observation, state) {
    if (containsForbiddenSentinelKey(observation) || containsForbiddenSentinelKey(state)) {
      return;
    }
    const existing = await getChatGptSentinelObservations();
    const observations = [observation, ...existing].slice(0, OBSERVATION_LIMIT);
    await storageSet$1({
      [STATE_KEY]: state,
      [OBSERVATIONS_KEY]: observations
    });
  }
  async function getChatGptSentinelObservations() {
    const items = await storageGet$1(OBSERVATIONS_KEY);
    const value = items[OBSERVATIONS_KEY];
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter(isChatGptSentinelObservation).slice(0, OBSERVATION_LIMIT);
  }
  function storageGet$1(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (items) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(items);
      });
    });
  }
  function storageSet$1(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(items, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
  }
  function isChatGptSentinelObservation(value) {
    const candidate = value;
    return typeof value === "object" && value !== null && candidate.source === "chatgpt-sentinel" && (candidate.urlKind === "chat-requirements" || candidate.urlKind === "prepare") && typeof candidate.ts === "number" && typeof candidate.powRequired === "boolean";
  }
  function isChatGptSentinelState(value) {
    const candidate = value;
    return typeof value === "object" && value !== null && typeof candidate.updatedAt === "number" && typeof candidate.sentinelRisk?.score === "number" && typeof candidate.sentinelRisk?.label === "string" && typeof candidate.pow?.risk === "number" && typeof candidate.gates?.powRequired === "boolean";
  }
  const IP_RISK_SETTINGS_KEY = "aiUsage:ipRisk:settings";
  const IP_RISK_STATE_KEY = "aiUsage:ipRisk:state";
  async function getStoredIpRiskSettings() {
    const items = await storageGet(IP_RISK_SETTINGS_KEY);
    return storedIpRiskSettingsFromValue(items[IP_RISK_SETTINGS_KEY]);
  }
  async function getIpRiskPublicSettings() {
    return publicIpRiskSettings(await getStoredIpRiskSettings());
  }
  async function saveIpRiskSettings(update) {
    const existing = await getStoredIpRiskSettings();
    const next = {
      provider: "proxycheck",
      enabled: update.enabled,
      proxycheckApiKey: existing.proxycheckApiKey
    };
    const apiKey = sanitizeProxycheckApiKey(update.apiKey);
    if (apiKey) {
      next.proxycheckApiKey = apiKey;
    }
    if (update.clearApiKey) {
      delete next.proxycheckApiKey;
    }
    await storageSet({ [IP_RISK_SETTINGS_KEY]: next });
    return publicIpRiskSettings(next);
  }
  async function getIpRiskState() {
    const items = await storageGet(IP_RISK_STATE_KEY);
    const state = items[IP_RISK_STATE_KEY];
    return isIpRiskState(state) ? state : null;
  }
  function setIpRiskState(state) {
    return storageSet({ [IP_RISK_STATE_KEY]: state });
  }
  function publicSettingsFromStorageValue(value) {
    return publicIpRiskSettings(storedIpRiskSettingsFromValue(value));
  }
  function ipRiskStateFromStorageValue(value) {
    return isIpRiskState(value) ? value : null;
  }
  function storedIpRiskSettingsFromValue(value) {
    if (typeof value !== "object" || value === null) {
      return {
        provider: "proxycheck",
        enabled: DEFAULT_IP_RISK_PUBLIC_SETTINGS.enabled
      };
    }
    const record = value;
    const apiKey = sanitizeProxycheckApiKey(record.proxycheckApiKey);
    return {
      provider: "proxycheck",
      enabled: record.enabled === true,
      ...apiKey ? { proxycheckApiKey: apiKey } : {}
    };
  }
  function isIpRiskState(value) {
    const candidate = value;
    return typeof value === "object" && value !== null && candidate.provider === "proxycheck" && candidate.source === "proxycheck.io" && typeof candidate.updatedAt === "number" && typeof candidate.signals === "object" && candidate.signals !== null;
  }
  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (items) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(items);
      });
    });
  }
  function storageSet(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(items, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
  }
  function isDebugEnabled() {
    try {
      return globalThis.localStorage?.getItem("aiUsageDebug") === "1";
    } catch {
      return false;
    }
  }
  function debugLog(message, details) {
    if (!isDebugEnabled()) {
      return;
    }
    if (details === void 0) {
      console.debug(`[ai-usage] ${message}`);
      return;
    }
    console.debug(`[ai-usage] ${message}`, details);
  }
  const platform = detectPlatform(window.location);
  if (platform) {
    void start(platform);
  }
  async function start(platformId) {
    let widget;
    const bridge = new BridgeClient();
    let currentSnapshot = null;
    let refreshing = false;
    let ipRiskRefreshing = false;
    let pendingEstimatorRefresh = 0;
    let codexProbeStarted = false;
    let stopCodexProbe = null;
    const refreshIpRisk = async (options) => {
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
      const cached2 = await getIpRiskState();
      if (cached2) {
        widget.setIpRiskState(cached2);
      }
      if (!options.force && cached2 && cached2.status === "ok" && Date.now() - cached2.updatedAt < IP_RISK_AUTO_REFRESH_MS) {
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
    const saveIpRisk = async (update) => {
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
          void saveIpRisk(update).catch((error) => {
            debugLog("failed to save IP risk settings", error);
          });
        }
      }
    );
    const maybeStartCodexProbe = (snapshot) => {
      if (platformId !== "chatgpt" || codexProbeStarted || hasCodexMeter(snapshot)) {
        return;
      }
      codexProbeStarted = true;
      stopCodexProbe = probeCodexAnalyticsUsage();
    };
    const applySnapshot = async (snapshot) => {
      const shouldReplace = platformId === "grok" && snapshot.source === "intercepted";
      currentSnapshot = mergeUsageSnapshots(
        shouldReplace ? null : currentSnapshot,
        snapshot
      );
      widget.setSnapshot(currentSnapshot);
      await setCachedSnapshot(currentSnapshot);
    };
    const refreshUsage = async (options) => {
      if (refreshing) {
        return;
      }
      const now = Date.now();
      const backoffUntil = await getBackoffUntil(platformId);
      widget.setBackoffUntil(backoffUntil);
      if (backoffUntil > now) {
        return;
      }
      const cached2 = await getCachedSnapshot(platformId);
      if (!options.force && cached2 && now - cached2.updatedAt < CACHE_TTL_MS) {
        currentSnapshot = cached2;
        widget.setSnapshot(cached2);
        return;
      }
      const lastRefreshAt = await getLastRefreshAt(platformId);
      if (lastRefreshAt > 0 && now - lastRefreshAt < MIN_REFRESH_INTERVAL_MS) {
        if (cached2) {
          currentSnapshot = cached2;
          widget.setSnapshot(cached2);
        }
        return;
      }
      refreshing = true;
      widget.setLoading(true);
      await setLastRefreshAt(platformId, now);
      try {
        let snapshot = await fetchPlatformUsage(
          platformId,
          (endpointKey, payload) => bridge.fetchUsage(platformId, endpointKey, payload)
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
          errorMessage: error instanceof Error ? error.message : "Unknown usage refresh error"
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
    const onSentinelEvent = (event) => {
      if (platformId !== "chatgpt") {
        return;
      }
      const observation = sanitizeSentinelObservation(
        event.detail
      );
      if (!observation) {
        return;
      }
      const state = toChatGPTSentinelState(observation);
      widget.setChatGptSentinelState(state);
      void rememberChatGptSentinelObservation(observation, state).catch(
        (error) => {
          debugLog("failed to cache sentinel observation", error);
        }
      );
    };
    window.addEventListener(CHATGPT_SENTINEL_EVENT, onSentinelEvent);
    const onStorageChanged = (changes, areaName) => {
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
      void applySnapshot(snapshot).catch((error) => {
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
      }, 1500);
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
  async function injectMainWorld() {
    const response = await new Promise(
      (resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: "AI_USAGE_INJECT_MAIN_WORLD" },
          (value) => {
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
  async function requestIpRiskRefresh() {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "AI_USAGE_IP_RISK_REFRESH" },
        (value) => {
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
  async function withEstimateFallback(platform2, snapshot) {
    if (snapshot.meters.length > 0 && snapshot.status !== "error") {
      return snapshot;
    }
    const estimate = await getEstimateSnapshot(platform2);
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
  async function updateFailureState(platform2, snapshot, widget) {
    if (snapshot.status !== "error") {
      await setFailureCount(platform2, 0);
      await setBackoffUntil(platform2, 0);
      widget.setBackoffUntil(0);
      return;
    }
    const failures = await getFailureCount(platform2);
    const nextFailures = failures + 1;
    const step = FAILED_BACKOFF_STEPS_MS[Math.min(nextFailures - 1, FAILED_BACKOFF_STEPS_MS.length - 1)];
    const backoffUntil = Date.now() + step;
    await setFailureCount(platform2, nextFailures);
    await setBackoffUntil(platform2, backoffUntil);
    widget.setBackoffUntil(backoffUntil);
  }
  function hasCodexMeter(snapshot) {
    return snapshot.meters.some(
      (meter) => meter.rawKind === "codex.settings.usage" || meter.key.toLowerCase().includes("codex")
    );
  }
})();
