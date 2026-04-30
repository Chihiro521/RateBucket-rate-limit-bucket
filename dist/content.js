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
      if (event.source !== window || event.origin !== window.location.origin) {
        return;
      }
      if (isInterceptedUsageMessage(event.data)) {
        for (const handler of this.interceptHandlers) {
          handler(event.data);
        }
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
  async function getCachedSnapshot(platform2) {
    const key = snapshotKey(platform2);
    const items = await storageGet(key);
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
    return storageSet({ [snapshotKey(snapshot.platform)]: persisted });
  }
  async function getLastRefreshAt(platform2) {
    const key = lastRefreshKey(platform2);
    const items = await storageGet(key);
    return typeof items[key] === "number" ? items[key] : 0;
  }
  function setLastRefreshAt(platform2, value) {
    return storageSet({ [lastRefreshKey(platform2)]: value });
  }
  async function getBackoffUntil(platform2) {
    const key = backoffKey(platform2);
    const items = await storageGet(key);
    return typeof items[key] === "number" ? items[key] : 0;
  }
  function setBackoffUntil(platform2, value) {
    return storageSet({ [backoffKey(platform2)]: value });
  }
  async function getFailureCount(platform2) {
    const key = failureCountKey(platform2);
    const items = await storageGet(key);
    return typeof items[key] === "number" ? items[key] : 0;
  }
  function setFailureCount(platform2, value) {
    return storageSet({ [failureCountKey(platform2)]: value });
  }
  async function getEstimateState(platform2) {
    const key = estimateKey(platform2);
    const items = await storageGet(key);
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
    await storageSet({ [estimateKey(platform2)]: next });
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
      return "just now";
    }
    if (seconds < 60) {
      return `${seconds}s ago`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes}m ago`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours}h ago`;
    }
    return `${Math.floor(hours / 24)}d ago`;
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
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 48) {
      return `${hours}h`;
    }
    return `${Math.floor(hours / 24)}d`;
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

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 10px 8px;
  border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
}

.title {
  font-size: 14px;
  font-weight: 750;
}

.actions {
  display: flex;
  gap: 6px;
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

.content {
  padding: 4px 10px 10px;
}

.meter {
  padding: 8px 0;
  border-top: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
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
`;
  const PLATFORM_LABEL = {
    grok: "Grok",
    claude: "Claude",
    chatgpt: "GPT"
  };
  class UsageWidget {
    constructor(platform2, onRefresh) {
      this.platform = platform2;
      this.onRefresh = onRefresh;
      const style = document.createElement("style");
      style.textContent = WIDGET_CSS;
      this.shadow.append(style, this.root);
      this.timerId = window.setInterval(() => this.render(), 15e3);
    }
    host = document.createElement("div");
    shadow = this.host.attachShadow({ mode: "open" });
    root = document.createElement("div");
    expanded = false;
    loading = false;
    snapshot = null;
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
    setBackoffUntil(value) {
      this.backoffUntil = value;
      this.render();
    }
    render() {
      this.root.replaceChildren(
        this.expanded ? this.renderPanel() : this.renderCollapsed()
      );
    }
    renderCollapsed() {
      const button = el("button", "collapsed");
      button.type = "button";
      button.setAttribute("aria-label", `Open ${PLATFORM_LABEL[this.platform]} usage`);
      button.addEventListener("click", () => {
        this.expanded = true;
        this.render();
      });
      button.append(
        el("span", `status-dot status-${this.snapshot?.status ?? "unknown"}`),
        node("span", "collapsed-main", [
          textEl("span", "platform", PLATFORM_LABEL[this.platform]),
          textEl("span", "primary", this.primaryValue())
        ])
      );
      return button;
    }
    renderPanel() {
      const panel = el("section", "panel");
      panel.append(this.renderHeader(), this.renderMeta(), this.renderContent());
      return panel;
    }
    renderHeader() {
      const header = el("div", "header");
      const title = textEl("div", "title", `${PLATFORM_LABEL[this.platform]} usage`);
      const actions = el("div", "actions");
      const refresh = textEl("button", "icon-button", this.loading ? "..." : "↻");
      refresh.type = "button";
      refresh.setAttribute("aria-label", "Refresh usage");
      refresh.title = "Refresh usage";
      refresh.disabled = this.loading || this.backoffRemainingMs() > 0;
      refresh.addEventListener("click", this.onRefresh);
      const close = textEl("button", "icon-button", "×");
      close.type = "button";
      close.setAttribute("aria-label", "Collapse usage widget");
      close.title = "Collapse";
      close.addEventListener("click", () => {
        this.expanded = false;
        this.render();
      });
      actions.append(refresh, close);
      header.append(title, actions);
      return header;
    }
    renderMeta() {
      const meta = el("div", "meta");
      const updated = this.snapshot ? `updated ${formatAge(this.snapshot.updatedAt)}` : "not updated";
      const right = this.backoffRemainingMs() > 0 ? `wait ${Math.ceil(this.backoffRemainingMs() / 1e3)}s` : this.snapshot?.cacheAgeMs !== void 0 ? `cache ${Math.floor(this.snapshot.cacheAgeMs / 1e3)}s` : this.loading ? "loading" : "";
      meta.append(textEl("span", "", updated), textEl("span", "", right));
      return meta;
    }
    renderContent() {
      const content = el("div", "content");
      if (this.snapshot?.errorMessage) {
        content.append(textEl("div", "error", this.snapshot.errorMessage));
      }
      const meters = this.snapshot?.meters ?? [];
      if (meters.length === 0) {
        content.append(textEl("div", "empty", "No usage data available yet"));
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
        textEl("div", "meter-label", meter.label),
        textEl("div", "meter-value", formatMeterValue(meter))
      );
      const progress = meterProgress(meter);
      const bar = el("div", "bar");
      const fill = el("div", "bar-fill");
      fill.style.width = `${progress}%`;
      bar.append(fill);
      const bottom = el("div", "meter-bottom");
      bottom.append(
        textEl("span", "badge", `${meter.source} · ${meter.confidence}`),
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
      const byPercent = meters.find((meter) => typeof meter.usedPercent === "number");
      if (byPercent?.usedPercent !== void 0 && byPercent.usedPercent !== null) {
        return `${Math.round(byPercent.usedPercent)}%`;
      }
      return "?";
    }
    backoffRemainingMs() {
      return Math.max(0, this.backoffUntil - Date.now());
    }
  }
  function formatMeterValue(meter) {
    if (typeof meter.remaining === "number" && typeof meter.total === "number") {
      return `${meter.remaining}/${meter.total}`;
    }
    if (typeof meter.remaining === "number") {
      return `${meter.remaining} left`;
    }
    if (typeof meter.used === "number" && typeof meter.total === "number") {
      return `${meter.used}/${meter.total} used`;
    }
    if (typeof meter.usedPercent === "number") {
      return `${Math.round(meter.usedPercent)}% used`;
    }
    return "unknown";
  }
  function meterProgress(meter) {
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
    const usedPercent = percentFromRatioOrPercent(
      getNumber(args.record, "used_percent")
    );
    const resetAt = args.record.reset_at;
    const resetValue = typeof resetAt === "string" || typeof resetAt === "number" ? resetAt : null;
    const windowSeconds = getNumber(args.record, "limit_window_seconds");
    if (usedPercent === null && resetValue === null && windowSeconds === null) {
      return null;
    }
    return {
      key: args.key,
      label: args.label,
      usedPercent,
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
          rawKind: "rate_limit.primary_window"
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
          rawKind: "rate_limit.secondary_window"
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
        rawKind: "code_review_rate_limit.primary_window"
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
    return meters;
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
    const candidates = collectCodexUsageCandidates(root);
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
  function collectCodexUsageCandidates(root) {
    const queue = [
      { path: "codex", value: root, depth: 0 }
    ];
    const candidates = [];
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item || item.depth > 4) {
        continue;
      }
      const record = asRecord(item.value);
      if (!record) {
        continue;
      }
      if (isCodexUsageLike(record)) {
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
  function isCodexUsageLike(record) {
    return numberFromKeys(record, ["remaining", "remaining_credits", "remainingCredits"]) !== null || numberFromKeys(record, ["total", "limit", "quota", "total_credits", "totalCredits"]) !== null || numberFromKeys(record, ["used", "usage", "used_credits", "usedCredits"]) !== null || numberFromKeys(record, ["used_percent", "usedPercent", "utilization"]) !== null || numberFromKeys(record, ["reset_after", "resetAfter", "reset_after_seconds"]) !== null || stringOrNumberFromKeys(record, ["reset_at", "resetAt", "resets_at"]) !== null;
  }
  function normalizeCodexUsageObject(path, record, source) {
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
    const usedPercent = percentFromRatioOrPercent(
      numberFromKeys(record, ["used_percent", "usedPercent", "utilization"])
    );
    const resetAt = stringOrNumberFromKeys(record, ["reset_at", "resetAt", "resets_at"]);
    const resetAfterSeconds = numberFromKeys(record, [
      "reset_after",
      "resetAfter",
      "reset_after_seconds"
    ]);
    const label = getString(record, "label") ?? getString(record, "name") ?? getString(record, "feature_name") ?? "Codex usage";
    if (remaining === null && total === null && used === null && usedPercent === null && resetAt === null && resetAfterSeconds === null) {
      return null;
    }
    return {
      key: `codex:${path}`,
      label: label === "Codex usage" ? label : `Codex ${titleFromKey(label)}`,
      remaining,
      total,
      used,
      usedPercent: usedPercent ?? (used !== null && total !== null && total > 0 ? percentFromRatioOrPercent(used / total) : null),
      resetAt,
      resetAfterSeconds,
      source,
      confidence: remaining !== null || total !== null || usedPercent !== null ? "medium" : "low",
      rawKind: "codex.settings.usage"
    };
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
    const failures = [];
    let defaultModelSlug;
    let blockedFeatures = [];
    const conversation = await fetcher("chatgpt:conversationInit");
    if (conversation.ok) {
      const normalized = normalizeChatGptConversationInit(conversation.json, "api");
      meters.push(...normalized.meters);
      defaultModelSlug = normalized.defaultModelSlug;
      blockedFeatures = normalized.blockedFeatures;
    } else {
      failures.push(responseFailure$2(conversation));
    }
    const wham = await fetcher("chatgpt:whamUsage");
    if (wham.ok) {
      meters.push(...normalizeChatGptWhamUsage(wham.json, "api"));
    } else {
      failures.push(responseFailure$2(wham));
    }
    const tasks = await fetcher("chatgpt:whamTasksRateLimit");
    if (tasks.ok) {
      meters.push(...normalizeTasksRateLimit(tasks.json, "api"));
    }
    const codexUsage = await fetcher("chatgpt:codexSettingsUsage");
    if (codexUsage.ok) {
      meters.push(...normalizeChatGptCodexSettingsUsage(codexUsage.json, "api"));
    }
    const hasBlocking = blockedFeatures.length > 0;
    return {
      platform: "chatgpt",
      meters,
      source: meters.length > 0 ? "api" : "unknown",
      updatedAt: Date.now(),
      status: meters.length > 0 ? failures.length > 0 || hasBlocking ? "partial" : "ok" : failures.length > 0 ? "error" : "unknown",
      errorMessage: hasBlocking ? "部分功能被限制" : failures.length > 0 ? failures[0] : void 0,
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
  const GROK_MODEL_CANDIDATES = [
    { modelName: "grok-3", endpointKey: "grok:grok-3", labelPrefix: "Grok" },
    {
      modelName: "grok-4-heavy",
      endpointKey: "grok:grok-4-heavy",
      labelPrefix: "Grok Heavy"
    }
  ];
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
    const modelName = options.modelName ?? "unknown";
    const labelPrefix = options.labelPrefix ?? "Grok";
    const windowSeconds = getNumber(record, "windowSizeSeconds");
    const meters = [];
    const queryMeter = makeMeter({
      key: `${modelName}:queries`,
      label: `${labelPrefix} query limit`,
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
      key: `${modelName}:tokens`,
      label: `${labelPrefix} token limit`,
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
        key: `${modelName}:low-effort`,
        label: `${labelPrefix} Low / Fast / Normal`,
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
        key: `${modelName}:high-effort`,
        label: `${labelPrefix} High / Thinking / Expert`,
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
  function responseFailure(response) {
    return formatUsageError(
      usageErrorFromBridge(response),
      response.endpointKey ?? "grok"
    );
  }
  async function fetchGrokUsage(fetcher) {
    const meters = [];
    const failures = [];
    for (const candidate of GROK_MODEL_CANDIDATES) {
      const response = await fetcher(candidate.endpointKey);
      if (!response.ok) {
        failures.push(responseFailure(response));
        continue;
      }
      meters.push(
        ...normalizeGrokRateLimit(response.json, {
          modelName: candidate.modelName,
          labelPrefix: candidate.labelPrefix,
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
        endpoint: GROK_MODEL_CANDIDATES.map((item) => item.endpointKey).join(","),
        parser: "grok.rateLimit"
      }
    };
  }
  function candidateForEndpoint(endpointKey) {
    return GROK_MODEL_CANDIDATES.find((item) => item.endpointKey === endpointKey);
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
      const candidate = candidateForEndpoint(args.endpointKey);
      return normalizeGrokRateLimit(args.json, {
        modelName: candidate?.modelName ?? "intercepted",
        labelPrefix: candidate?.labelPrefix ?? "Grok",
        source: "intercepted"
      });
    }
    if (args.platform === "claude") {
      return normalizeClaudeUsage(args.json, "intercepted");
    }
    return normalizeChatGptIntercepted(args.url, args.json);
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
    const widget = new UsageWidget(platformId, () => {
      void refreshUsage({ force: true });
    });
    const bridge = new BridgeClient();
    let currentSnapshot = null;
    let refreshing = false;
    let pendingEstimatorRefresh = 0;
    const applySnapshot = async (snapshot) => {
      currentSnapshot = {
        ...snapshot,
        cacheAgeMs: Math.max(0, Date.now() - snapshot.updatedAt)
      };
      widget.setSnapshot(currentSnapshot);
      await setCachedSnapshot(snapshot);
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
    bridge.onIntercepted((message) => {
      if (message.platform !== platformId) {
        return;
      }
      const snapshot = normalizeInterceptedUsage({
        platform: platformId,
        url: message.url,
        json: message.json,
        ts: message.ts,
        endpointKey: message.endpointKey
      });
      if (snapshot.meters.length === 0) {
        return;
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
})();
