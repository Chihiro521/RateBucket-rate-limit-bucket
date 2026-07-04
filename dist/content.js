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
  function storageGet$3(keys) {
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
  function storageSet$3(items) {
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
    const items = await storageGet$3(key);
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
    return storageSet$3({ [snapshotKey(snapshot.platform)]: persisted });
  }
  async function getLastRefreshAt(platform2) {
    const key = lastRefreshKey(platform2);
    const items = await storageGet$3(key);
    return typeof items[key] === "number" ? items[key] : 0;
  }
  function setLastRefreshAt(platform2, value) {
    return storageSet$3({ [lastRefreshKey(platform2)]: value });
  }
  async function getBackoffUntil(platform2) {
    const key = backoffKey(platform2);
    const items = await storageGet$3(key);
    return typeof items[key] === "number" ? items[key] : 0;
  }
  function setBackoffUntil(platform2, value) {
    return storageSet$3({ [backoffKey(platform2)]: value });
  }
  async function getFailureCount(platform2) {
    const key = failureCountKey(platform2);
    const items = await storageGet$3(key);
    return typeof items[key] === "number" ? items[key] : 0;
  }
  function setFailureCount(platform2, value) {
    return storageSet$3({ [failureCountKey(platform2)]: value });
  }
  async function getEstimateState(platform2) {
    const key = estimateKey(platform2);
    const items = await storageGet$3(key);
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
    await storageSet$3({ [estimateKey(platform2)]: next });
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
  const DEFAULT_LANGUAGE_MODE = "auto";
  const ZH_TEXT = {
    "action.closeSettings": "关闭设置",
    "action.collapsePanel": "折叠用量面板",
    "action.collapseWidget": "收起用量组件",
    "action.expandPanel": "展开用量面板",
    "action.hidePanel": "隐藏用量面板",
    "action.openUsage": "打开 {platform} 用量",
    "action.refreshUsage": "刷新用量",
    "action.restoreGptPanel": "恢复 GPT 用量面板",
    "action.settings": "设置",
    "action.toggleSecret": "显示或隐藏密钥",
    "gpt.alertCount": "{count} 项预警",
    "gpt.title": "GPT 用量",
    "ip.apiKeyLabel": "proxycheck.io API 密钥",
    "ip.check": "IP 检测",
    "ip.deleteKey": "删除密钥",
    "ip.enableProxycheck": "启用 proxycheck.io",
    "ip.enabledHelp": "proxycheck.io 密钥仅保存在本地，检测结果不代表 OpenAI 官方账号状态。",
    "ip.errorFallback": "检测失败",
    "ip.help": "密钥保存在 chrome.storage.local。检测会先临时获取当前公网 IP，再查询 proxycheck.io，不保存历史 IP。",
    "ip.keyPlaceholder": "输入 proxycheck.io API 密钥",
    "ip.newKeyPlaceholder": "输入新的 proxycheck.io API 密钥",
    "ip.noProxySignals": "未见明显代理信号",
    "ip.querying": "正在查询 proxycheck.io。",
    "ip.savedKeyPlaceholder": "已保存密钥，留空则不修改",
    "ip.source": "来源",
    "ip.disabledHelp": "可在设置中启用 proxycheck.io 作为第三方 IP 信誉检测源。",
    "ip.signal": "信号",
    "ip.status.checking": "检测中",
    "ip.status.disabled": "未启用",
    "ip.status.failed": "检测失败",
    "ip.status.missingKey": "未配置密钥",
    "ip.status.waiting": "等待检测",
    "language.auto": "跟随浏览器",
    "language.en": "English",
    "language.label": "语言",
    "language.zhCN": "简体中文",
    "meta.cacheSeconds": "缓存 {seconds}秒",
    "meta.loading": "加载中",
    "meta.neverUpdated": "尚未更新",
    "meta.updatedAt": "更新于 {age}",
    "meta.waitSeconds": "等待 {seconds}秒",
    "meter.unknown": "未知",
    "meter.used": "已用 {used}/{total}",
    "meter.usedPercent": "{percent}% 已用",
    "meter.remaining": "剩余 {remaining}",
    "meter.remainingPercent": "{percent}% 剩余",
    "model.label": "模型",
    "settings.checkNow": "立即检测",
    "settings.save": "保存",
    "settings.title": "设置",
    "sentinel.accountStatus": "账号状态",
    "sentinel.explanation": "说明：当前仅验证 PoW 难度，不判断模型 fallback。",
    "sentinel.gate": "发送门禁",
    "usage.empty": "暂无用量数据",
    "usage.networkRisk": "网络风险",
    "usage.title": "{platform} 用量"
  };
  const EN_TEXT = {
    "action.closeSettings": "Close settings",
    "action.collapsePanel": "Collapse usage panel",
    "action.collapseWidget": "Collapse usage widget",
    "action.expandPanel": "Expand usage panel",
    "action.hidePanel": "Hide usage panel",
    "action.openUsage": "Open {platform} usage",
    "action.refreshUsage": "Refresh usage",
    "action.restoreGptPanel": "Restore GPT usage panel",
    "action.settings": "Settings",
    "action.toggleSecret": "Show or hide key",
    "gpt.alertCount": "{count} alerts",
    "gpt.title": "GPT Usage",
    "ip.apiKeyLabel": "proxycheck.io API key",
    "ip.check": "IP check",
    "ip.deleteKey": "Delete key",
    "ip.enableProxycheck": "Enable proxycheck.io",
    "ip.enabledHelp": "The proxycheck.io key is stored locally only. Results do not represent official OpenAI account status.",
    "ip.errorFallback": "Check failed",
    "ip.help": "The key is stored in chrome.storage.local. Checks temporarily fetch the current public IP, query proxycheck.io, and do not keep IP history.",
    "ip.keyPlaceholder": "Enter proxycheck.io API key",
    "ip.newKeyPlaceholder": "Enter a new proxycheck.io API key",
    "ip.noProxySignals": "No clear proxy signals",
    "ip.querying": "Querying proxycheck.io.",
    "ip.savedKeyPlaceholder": "Key saved. Leave blank to keep it",
    "ip.source": "Source",
    "ip.disabledHelp": "Enable proxycheck.io in settings as a third-party IP reputation source.",
    "ip.signal": "Signals",
    "ip.status.checking": "Checking",
    "ip.status.disabled": "Disabled",
    "ip.status.failed": "Check failed",
    "ip.status.missingKey": "Missing key",
    "ip.status.waiting": "Waiting to check",
    "language.auto": "Follow browser",
    "language.en": "English",
    "language.label": "Language",
    "language.zhCN": "Simplified Chinese",
    "meta.cacheSeconds": "Cached {seconds}s",
    "meta.loading": "Loading",
    "meta.neverUpdated": "Not updated yet",
    "meta.updatedAt": "Updated {age}",
    "meta.waitSeconds": "Wait {seconds}s",
    "meter.unknown": "Unknown",
    "meter.used": "Used {used}/{total}",
    "meter.usedPercent": "{percent}% used",
    "meter.remaining": "Remaining {remaining}",
    "meter.remainingPercent": "{percent}% remaining",
    "model.label": "Model",
    "settings.checkNow": "Check now",
    "settings.save": "Save",
    "settings.title": "Settings",
    "sentinel.accountStatus": "Account status",
    "sentinel.explanation": "Note: currently only validates PoW difficulty, not model fallback.",
    "sentinel.gate": "Send gate",
    "usage.empty": "No usage data yet",
    "usage.networkRisk": "Network risk",
    "usage.title": "{platform} Usage"
  };
  const TEXT = {
    "zh-CN": ZH_TEXT,
    en: EN_TEXT
  };
  const GPT_SECTION_LABELS = {
    "zh-CN": {
      input: "输入与附件",
      features: "GPT 功能额度",
      windows: "用量窗口",
      codex: "余额 / Codex",
      other: "其他"
    },
    en: {
      input: "Input and attachments",
      features: "GPT feature limits",
      windows: "Usage windows",
      codex: "Balance / Codex",
      other: "Other"
    }
  };
  const SOURCE_LABELS = {
    "zh-CN": {
      api: "接口",
      intercepted: "捕获",
      estimate: "估算",
      unknown: "未知"
    },
    en: {
      api: "API",
      intercepted: "Captured",
      estimate: "Estimate",
      unknown: "Unknown"
    }
  };
  const CONFIDENCE_LABELS = {
    "zh-CN": {
      high: "高",
      medium: "中",
      low: "低"
    },
    en: {
      high: "High",
      medium: "Medium",
      low: "Low"
    }
  };
  const STATUS_LABELS = {
    "zh-CN": {
      ok: "正常",
      partial: "部分可用",
      unknown: "未知",
      error: "错误"
    },
    en: {
      ok: "OK",
      partial: "Partial",
      unknown: "Unknown",
      error: "Error"
    }
  };
  const RISK_LABELS = {
    "zh-CN": {
      正常: "正常",
      偏高: "偏高",
      高: "高",
      严重: "严重",
      未知: "未知"
    },
    en: {
      正常: "Normal",
      偏高: "Elevated",
      高: "High",
      严重: "Severe",
      未知: "Unknown"
    }
  };
  const METER_LABELS_ZH = {
    "File Upload": "文件上传",
    "Paste Text To File": "粘贴文本转文件",
    Dictation: "听写",
    "Deep Research": "深度研究",
    "Image Generation": "图像生成",
    "Primary window": "主窗口",
    "Weekly window": "每周窗口",
    "Current Grok limit": "当前 Grok 限额",
    "Weekly Grok limit": "每周 Grok 限额",
    "Monthly Grok limit": "每月 Grok 限额",
    Chat: "聊天",
    "Grok Build": "Grok Build",
    API: "API",
    Build: "Build",
    Voice: "Voice",
    "Tasks rate limit": "任务限额",
    "Code Review": "代码审查",
    Credits: "余额",
    "Credits (unlimited)": "余额（无限）",
    "Gemini 5h": "Gemini 5 小时",
    "Gemini weekly": "Gemini 每周",
    Pro: "Pro",
    Labs: "Labs",
    "Agentic Research": "智能体研究",
    "Free queries": "免费查询"
  };
  function isLanguageMode(value) {
    return value === "auto" || value === "zh-CN" || value === "en";
  }
  function languageModeFromValue(value) {
    return isLanguageMode(value) ? value : DEFAULT_LANGUAGE_MODE;
  }
  function resolveLanguage(mode, browserLanguages = browserLanguageCandidates()) {
    if (mode !== "auto") {
      return mode;
    }
    for (const language of browserLanguages) {
      const normalized = language.trim().toLowerCase();
      if (normalized.startsWith("zh")) {
        return "zh-CN";
      }
      if (normalized.startsWith("en")) {
        return "en";
      }
    }
    return "en";
  }
  function t(language, key, params = {}) {
    return TEXT[language][key].replace(
      /\{(\w+)\}/g,
      (_, name) => params[name] === void 0 ? "" : String(params[name])
    );
  }
  function formatAgeLocalized(language, timestamp, now = Date.now()) {
    const seconds = Math.max(0, Math.floor((now - timestamp) / 1e3));
    if (seconds < 5) {
      return language === "zh-CN" ? "刚刚" : "just now";
    }
    if (seconds < 60) {
      return language === "zh-CN" ? `${seconds}秒前` : `${seconds}s ago`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return language === "zh-CN" ? `${minutes}分钟前` : `${minutes}m ago`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return language === "zh-CN" ? `${hours}小时前` : `${hours}h ago`;
    }
    const days = Math.floor(hours / 24);
    return language === "zh-CN" ? `${days}天前` : `${days}d ago`;
  }
  function formatResetLocalized(language, meter, now = Date.now()) {
    const resetMs = resolveResetMs(meter, now);
    if (resetMs === null) {
      return "";
    }
    const seconds = Math.max(0, Math.floor((resetMs - now) / 1e3));
    if (seconds < 60) {
      return language === "zh-CN" ? `${seconds}秒` : `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return language === "zh-CN" ? `${minutes}分钟` : `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 48) {
      return language === "zh-CN" ? `${hours}小时` : `${hours}h`;
    }
    const days = Math.floor(hours / 24);
    return language === "zh-CN" ? `${days}天` : `${days}d`;
  }
  function formatMeterValueLocalized(language, meter) {
    if (typeof meter.remainingPercent === "number") {
      return t(language, "meter.remainingPercent", {
        percent: Math.round(meter.remainingPercent)
      });
    }
    if (typeof meter.remaining === "number" && typeof meter.total === "number") {
      return `${meter.remaining}/${meter.total}`;
    }
    if (typeof meter.remaining === "number") {
      return t(language, "meter.remaining", { remaining: meter.remaining });
    }
    if (typeof meter.used === "number" && typeof meter.total === "number") {
      return t(language, "meter.used", {
        used: meter.used,
        total: meter.total
      });
    }
    if (typeof meter.usedPercent === "number") {
      return t(language, "meter.usedPercent", {
        percent: Math.round(meter.usedPercent)
      });
    }
    return t(language, "meter.unknown");
  }
  function formatMeterLabelLocalized(language, meter) {
    if (language === "en") {
      return meter.label;
    }
    const direct = METER_LABELS_ZH[meter.label];
    if (direct) {
      return direct;
    }
    return meter.label.replace(/\bquery limit\b/gi, "查询额度").replace(/\btoken limit\b/gi, "token 额度").replace(/\bLow \/ Fast \/ Normal\b/g, "低 / 快速 / 普通").replace(/\bHigh \/ Thinking \/ Expert\b/g, "高 / 思考 / 专家").replace(/\bCodex usage\b/gi, "Codex 用量").replace(/\bPrimary window\b/gi, "主窗口").replace(/\bWeekly window\b/gi, "每周窗口").replace(/\b5[- ]?hour\b/gi, "5 小时").replace(/\bweekly\b/gi, "每周").replace(/\busage limit\b/gi, "使用限额").replace(/\brate limit\b/gi, "使用限额");
  }
  function formatGptSectionLabelLocalized(language, section) {
    return GPT_SECTION_LABELS[language][section];
  }
  function formatSourceLabelLocalized(language, source) {
    return SOURCE_LABELS[language][source] ?? source;
  }
  function formatConfidenceLabelLocalized(language, confidence) {
    return CONFIDENCE_LABELS[language][confidence] ?? confidence;
  }
  function formatStatusLabelLocalized(language, status) {
    return STATUS_LABELS[language][status] ?? status;
  }
  function formatRiskLabelLocalized(language, label) {
    return RISK_LABELS[language][label] ?? label;
  }
  function browserLanguageCandidates() {
    if (typeof navigator === "undefined") {
      return [];
    }
    if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
      return [...navigator.languages];
    }
    return navigator.language ? [navigator.language] : [];
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
  background: #315d86;
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
  background: #3f5874;
}

.grok-stack-bar {
  overflow: visible;
}

.grok-stack-fill {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: inherit;
}

.grok-stack-segment {
  display: block;
  height: 100%;
}

.grok-contribution-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 10px;
  margin-top: 8px;
  color: color-mix(in srgb, CanvasText 70%, transparent);
  font-size: 11px;
}

.grok-contribution {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.grok-contribution-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  box-shadow: 0 0 0 1px color-mix(in srgb, Canvas 35%, transparent);
}

.grok-contribution-value {
  color: color-mix(in srgb, CanvasText 82%, transparent);
  font-weight: 700;
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
  background: #315d86;
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

.settings-popover > .settings-input {
  margin-bottom: 12px;
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

/* Cold blue capsule shell. Keeps the widget DOM stable while replacing the visual skin. */
:host {
  color-scheme: light;
  --rb-ink: #253244;
  --rb-ink-soft: #405063;
  --rb-blue: #25364d;
  --rb-blue-deep: #1d2b3f;
  --rb-blue-soft: #3f5874;
  --rb-blue-pale: #8fa8c4;
  --rb-paper: #fbf5eb;
  --rb-paper-soft: #f4ebdd;
  --rb-paper-warm: #fffaf1;
  --rb-brown: #70675d;
  --rb-brown-soft: #b7aa99;
  --rb-line: rgba(111, 101, 89, 0.38);
  --rb-line-strong: rgba(35, 50, 70, 0.72);
  --rb-mustard: #d4a644;
  --rb-mustard-deep: #b98225;
  --rb-red: #b85a4a;
  --rb-shadow: 0 18px 42px rgba(25, 34, 46, 0.24);
  --rb-soft-shadow: 0 9px 22px rgba(37, 45, 56, 0.16);
  --rb-inner: inset 0 0 0 1px rgba(255, 255, 255, 0.76);
  color: var(--rb-ink);
}

.panel,
.gpt-panel,
.gpt-collapsed-panel,
.settings-popover {
  border: 1px solid var(--rb-line);
  background:
    linear-gradient(180deg, rgba(255, 252, 246, 0.98), rgba(246, 238, 225, 0.96)),
    repeating-linear-gradient(90deg, rgba(63, 88, 116, 0.03) 0 1px, transparent 1px 28px);
  color: var(--rb-ink);
  box-shadow: var(--rb-shadow), var(--rb-inner);
}

.panel,
.gpt-panel,
.gpt-collapsed-panel {
  position: relative;
  overflow: hidden;
}

.panel,
.gpt-panel {
  border-radius: 18px;
}

.panel {
  width: min(314px, calc(100vw - 24px));
  padding-bottom: 18px;
}

.gpt-panel {
  width: min(390px, calc(100vw - 16px));
  height: min(552px, calc(100vh - 16px));
  min-height: 380px;
}

.settings-popover {
  border-radius: 16px;
  padding: 0 12px 12px;
}

.panel::before,
.gpt-panel::before,
.settings-popover::before {
  content: "";
  display: block;
  height: 4px;
  background: linear-gradient(90deg, transparent, rgba(143, 168, 196, 0.7), rgba(212, 166, 68, 0.78), rgba(143, 168, 196, 0.7), transparent);
}

.panel::after,
.gpt-panel::after {
  content: "";
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 20px;
  border-top: 1px solid rgba(255, 250, 241, 0.24);
  background:
    radial-gradient(circle at 22px 50%, var(--rb-mustard) 0 5px, transparent 6px),
    radial-gradient(circle at 46px 50%, #f0d78a 0 4px, transparent 5px),
    radial-gradient(circle at 70px 50%, var(--rb-blue-pale) 0 4px, transparent 5px),
    linear-gradient(180deg, var(--rb-blue), var(--rb-blue-deep));
  pointer-events: none;
  z-index: 0;
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
.settings-actions,
.sentinel-block,
.meter,
.meter-section {
  position: relative;
  z-index: 1;
}

.header {
  min-height: 52px;
  padding: 10px 12px 9px;
  border-bottom-color: rgba(112, 103, 93, 0.22);
  background:
    linear-gradient(180deg, rgba(255, 250, 241, 0.9), rgba(244, 235, 221, 0.72)),
    linear-gradient(90deg, rgba(63, 88, 116, 0.12), transparent 52%, rgba(212, 166, 68, 0.12));
}

.header::after {
  content: "";
  position: absolute;
  right: 14px;
  bottom: -1px;
  left: 14px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(112, 103, 93, 0.58), rgba(212, 166, 68, 0.56), transparent);
}

.title,
.gpt-title,
.settings-title,
.meter-section-title {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: var(--rb-ink);
  font-weight: 780;
  letter-spacing: 0;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.9);
}

.title::before,
.gpt-title::before,
.settings-title::before,
.meter-section-title::before {
  content: none;
}

.title-text,
.section-title-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title-icon,
.section-title-icon,
.inline-icon,
.section-badge,
.progress-leaf,
.chip-icon,
.vine-divider-image,
.corner,
.card-corner {
  display: block;
  object-fit: contain;
  user-select: none;
  -webkit-user-select: none;
}

.title-icon {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  filter: drop-shadow(0 2px 4px rgba(31, 43, 59, 0.18));
}

.gpt-title .title-icon {
  width: 25px;
  height: 25px;
  flex-basis: 25px;
}

.settings-title .title-icon {
  width: 20px;
  height: 20px;
  flex-basis: 20px;
}

.gpt-alerts,
.gpt-collapsed-summary,
.meta,
.model-meta,
.sentinel-row,
.meter-bottom,
.settings-help {
  color: var(--rb-brown);
}

.gpt-alerts {
  padding: 3px 8px;
  border: 1px solid rgba(112, 103, 93, 0.28);
  border-radius: 999px;
  background: rgba(255, 250, 241, 0.7);
  font-size: 11px;
  box-shadow: var(--rb-inner);
}

.icon-button,
.settings-button {
  border: 1px solid rgba(112, 103, 93, 0.38);
  background: linear-gradient(145deg, rgba(255, 250, 241, 0.98), rgba(239, 230, 215, 0.9));
  color: var(--rb-blue);
  box-shadow: 0 2px 8px rgba(38, 48, 62, 0.13), var(--rb-inner);
}

.icon-button {
  width: 28px;
  height: 28px;
  border-radius: 10px;
}

.icon-button:hover,
.settings-button:hover {
  border-color: rgba(63, 88, 116, 0.62);
  background: linear-gradient(145deg, #fffdf7, #e9edf1);
  transform: translateY(-1px);
}

.icon-button:active,
.settings-button:active {
  transform: translateY(0);
  box-shadow: inset 0 2px 5px rgba(38, 48, 62, 0.16);
}

.icon-button:disabled,
.settings-button:disabled {
  color: rgba(64, 80, 99, 0.44);
  box-shadow: none;
}

.primary-button {
  border-color: rgba(37, 54, 77, 0.72);
  background: linear-gradient(145deg, var(--rb-blue-soft), var(--rb-blue));
  color: var(--rb-paper-warm);
}

.danger-button,
.error,
.error-text {
  color: var(--rb-red);
}

.collapsed,
.gpt-restore-chip {
  position: relative;
  width: min(172px, calc(100vw - 14px));
  min-width: 160px;
  height: 44px;
  min-height: 44px;
  grid-template-columns: 78px 7px minmax(0, 1fr);
  gap: 3px;
  align-items: center;
  overflow: visible;
  border: 1.5px solid var(--rb-line-strong);
  border-radius: 999px;
  background:
    linear-gradient(90deg, var(--rb-blue) 0 46px, transparent 46px),
    linear-gradient(180deg, var(--rb-paper-warm), var(--rb-paper-soft));
  color: var(--rb-ink);
  box-shadow: var(--rb-soft-shadow), var(--rb-inner);
  padding: 0 7px 0 6px;
}

.collapsed::before,
.gpt-restore-chip::before {
  content: "";
  position: absolute;
  top: 5px;
  bottom: 5px;
  left: 5px;
  width: 36px;
  border-radius: 999px 7px 7px 999px;
  background: linear-gradient(145deg, #344963, var(--rb-blue-deep));
  box-shadow:
    inset 0 0 0 1px rgba(255, 249, 237, 0.28),
    inset -8px 0 14px rgba(8, 17, 30, 0.18);
  pointer-events: none;
}

.collapsed::after,
.gpt-restore-chip::after {
  content: "";
  position: absolute;
  top: 8px;
  left: 11px;
  z-index: 1;
  width: 30px;
  height: 28px;
  border-radius: 999px;
  background:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpolygon fill='%23fffaf1' points='8,0 10.3,5.3 16,6 11.7,9.8 12.9,16 8,12.8 3.1,16 4.3,9.8 0,6 5.7,5.3'/%3E%3C/svg%3E") 3px 18px / 9px 9px no-repeat,
    radial-gradient(circle at 8px 7px, var(--rb-paper-warm) 0 4px, transparent 5px),
    radial-gradient(circle at 19px 20px, var(--rb-mustard) 0 3px, transparent 4px),
    radial-gradient(circle at 27px 8px, #c5cbd0 0 3px, transparent 4px);
  pointer-events: none;
}

.collapsed:hover,
.gpt-restore-chip:hover {
  border-color: rgba(35, 50, 70, 0.86);
  background:
    linear-gradient(90deg, #2d405a 0 46px, transparent 46px),
    linear-gradient(180deg, #fffdf7, #f1e9db);
  transform: translateY(-1px);
}

.chip-icon {
  position: absolute;
  top: 50%;
  left: 32px;
  z-index: 2;
  width: 14px;
  height: 14px;
  opacity: 0;
  transform: translateY(-50%);
  filter: drop-shadow(0 1px 2px rgba(10, 18, 30, 0.34));
}

.status-dot {
  position: relative;
  z-index: 3;
  grid-column: 2;
  justify-self: center;
  width: 7px;
  height: 7px;
  box-shadow: 0 0 0 1.5px rgba(255, 250, 241, 0.88);
}

.status-ok {
  background: var(--rb-blue-soft);
}

.status-partial {
  background: var(--rb-mustard);
}

.status-error {
  background: var(--rb-red);
}

.collapsed-main {
  position: relative;
  z-index: 2;
  display: grid;
  grid-column: 3;
  grid-template-columns: minmax(0, 1fr) 1px auto;
  column-gap: 4px;
  align-items: center;
  min-width: 0;
  padding-left: 0;
}

.collapsed-main::before {
  content: "";
  grid-column: 2;
  grid-row: 1;
  position: relative;
  z-index: 3;
  width: 1px;
  height: 22px;
  background: rgba(125, 114, 99, 0.34);
}

.platform {
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
  color: var(--rb-ink-soft);
  overflow: hidden;
  font-size: 10px;
  font-weight: 760;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.primary {
  grid-column: 3;
  grid-row: 1;
  position: relative;
  z-index: 4;
  color: var(--rb-ink);
  font-size: 11px;
  font-weight: 780;
  line-height: 1;
  padding-left: 5px;
  background: linear-gradient(90deg, rgba(255, 250, 241, 0.08), var(--rb-paper-warm) 7px);
  text-align: right;
}

.platform-overflow .platform {
  position: absolute;
  left: -42px;
  right: 46px;
  z-index: 1;
  box-sizing: border-box;
  padding-left: 14px;
}

.platform-overflow .platform::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 0;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--rb-blue-soft);
  box-shadow: 0 0 0 1.5px rgba(255, 250, 241, 0.88);
  transform: translateY(-50%);
}

.platform-overflow .status-dot {
  opacity: 0;
}

.platform-overflow .status-partial + .collapsed-main .platform::before {
  background: var(--rb-mustard);
}

.platform-overflow .status-error + .collapsed-main .platform::before {
  background: var(--rb-red);
}

.capsule-mascot {
  position: absolute;
  left: 72px;
  bottom: -22px;
  z-index: 5;
  width: 166px;
  height: auto;
  max-width: none;
  object-fit: contain;
  object-position: center bottom;
  pointer-events: none;
  transform: translateX(-50%);
  filter: drop-shadow(0 6px 9px rgba(24, 33, 44, 0.24));
}

.gpt-collapsed-panel {
  width: min(392px, calc(100vw - 16px));
  min-height: 64px;
  grid-template-columns: minmax(118px, auto) minmax(68px, 1fr) auto;
  gap: 9px;
  align-items: center;
  border-radius: 999px;
  overflow: visible;
  padding: 8px 12px 8px 118px;
  background:
    linear-gradient(90deg, var(--rb-blue) 0 96px, transparent 96px),
    linear-gradient(180deg, var(--rb-paper-warm), var(--rb-paper-soft));
}

.gpt-collapsed-panel .capsule-mascot {
  left: 82px;
  bottom: -7px;
  width: 112px;
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

.meta,
.gpt-panel > .meta,
.model-meta {
  border-color: rgba(112, 103, 93, 0.2);
  background: rgba(255, 250, 241, 0.58);
}

.meta {
  padding: 8px 12px;
  font-size: 11px;
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
  opacity: 0.68;
}

.content {
  padding: 6px 10px 20px;
}

.gpt-content {
  padding: 0 10px 28px;
  background:
    radial-gradient(circle at 50% 0%, rgba(143, 168, 196, 0.2), transparent 34%),
    linear-gradient(180deg, rgba(255, 250, 241, 0.58), rgba(246, 238, 225, 0.62));
  scrollbar-width: thin;
  scrollbar-color: rgba(63, 88, 116, 0.32) transparent;
}

.gpt-content::-webkit-scrollbar,
.gpt-content:hover::-webkit-scrollbar,
.gpt-content:focus-within::-webkit-scrollbar {
  width: 6px;
}

.gpt-content::-webkit-scrollbar-thumb {
  background: rgba(63, 88, 116, 0.32);
}

.panel-corners,
.card-corners {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.corner {
  position: absolute;
  width: 34px;
  height: 34px;
  opacity: 0.48;
}

.compact-corners .corner {
  width: 26px;
  height: 26px;
  opacity: 0.34;
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
  bottom: 21px;
  left: 3px;
}

.corner-bottom-right {
  right: 3px;
  bottom: 21px;
}

.meter-section {
  margin-top: 9px;
  padding: 10px 12px 10px;
  border: 1px solid rgba(112, 103, 93, 0.28);
  border-radius: 12px;
  background:
    linear-gradient(180deg, rgba(255, 253, 247, 0.92), rgba(247, 239, 225, 0.82)),
    radial-gradient(circle at 100% 0%, rgba(143, 168, 196, 0.16), transparent 32%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.62), 0 7px 16px rgba(37, 45, 56, 0.08);
  overflow: hidden;
}

.meter-section::before {
  content: "";
  position: absolute;
  inset: 5px;
  border: 1px solid rgba(112, 103, 93, 0.12);
  border-radius: 8px;
  pointer-events: none;
  z-index: 0;
}

.meter-section::after {
  content: none;
}

.meter-section-title {
  position: relative;
  z-index: 1;
  padding: 1px 30px 7px 0;
  color: var(--rb-ink);
  font-size: 13px;
}

.meter-section-title::after {
  content: "";
  height: 1px;
  min-width: 24px;
  flex: 1 1 auto;
  background: linear-gradient(90deg, rgba(63, 88, 116, 0.35), rgba(212, 166, 68, 0.24), transparent);
}

.section-title-icon {
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
}

.section-badge {
  position: absolute;
  top: 9px;
  right: 10px;
  width: 24px;
  height: 24px;
  z-index: 1;
  opacity: 0.9;
  filter: drop-shadow(0 3px 5px rgba(31, 43, 59, 0.16));
}

.shield-badge {
  top: 27px;
  width: 36px;
  height: 36px;
}

.ip-risk-block {
  padding-right: 48px;
}

.card-corners {
  opacity: 0.34;
}

.card-corner {
  position: absolute;
  width: 18px;
  height: 18px;
  opacity: 0.48;
}

.card-corner-top-left {
  top: 3px;
  left: 3px;
}

.card-corner-bottom-right {
  display: none;
}

.meter,
.gpt-content .meter {
  padding: 9px 0;
  border-top-color: rgba(112, 103, 93, 0.18);
  border-radius: 8px;
}

.meter:hover {
  background: rgba(143, 168, 196, 0.12);
}

.meter-label {
  color: var(--rb-ink);
  font-weight: 760;
}

.meter-value {
  color: var(--rb-blue);
  font-weight: 760;
}

.bar {
  position: relative;
  height: 8px;
  margin-top: 8px;
  overflow: visible;
  border: 1px solid rgba(112, 103, 93, 0.2);
  background: linear-gradient(180deg, #e9dfd0, #f6eee2);
  box-shadow: inset 0 1px 2px rgba(54, 72, 94, 0.12);
}

.bar-fill {
  position: relative;
  background: linear-gradient(90deg, var(--rb-blue), var(--rb-blue-soft));
  box-shadow: 0 0 8px rgba(63, 88, 116, 0.24);
}

.bar-fill.remaining-fill {
  background: linear-gradient(90deg, var(--rb-blue-soft), var(--rb-mustard));
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
  transform: translate(-50%, -50%);
  filter: drop-shadow(0 1px 2px rgba(31, 43, 59, 0.28));
  pointer-events: none;
}

.sentinel-risk-normal {
  background: linear-gradient(90deg, var(--rb-blue), var(--rb-blue-soft));
}

.sentinel-risk-elevated {
  background: linear-gradient(90deg, var(--rb-mustard-deep), var(--rb-mustard));
}

.sentinel-risk-high {
  background: linear-gradient(90deg, #b56a33, #e0a24d);
}

.sentinel-risk-severe {
  background: linear-gradient(90deg, #9f463e, var(--rb-red));
}

.sentinel-label {
  color: var(--rb-ink-soft);
}

.sentinel-explanation {
  color: var(--rb-brown);
}

.badge {
  border-color: rgba(112, 103, 93, 0.28);
  background: linear-gradient(180deg, rgba(255, 250, 241, 0.96), rgba(239, 230, 215, 0.86));
  color: var(--rb-blue);
  box-shadow: var(--rb-inner);
}

.badge::before {
  content: "•";
  margin-right: 4px;
  color: var(--rb-blue-soft);
}

.settings-header {
  padding: 10px 0 9px;
  border-bottom: 1px solid rgba(112, 103, 93, 0.22);
}

.settings-check {
  color: var(--rb-ink);
}

.settings-input-wrap,
.settings-input {
  border-color: rgba(112, 103, 93, 0.34);
  background: rgba(255, 250, 241, 0.86);
  color: var(--rb-ink);
}

.settings-input::placeholder {
  color: rgba(112, 103, 93, 0.62);
}

.settings-input-wrap:focus-within,
.settings-input:focus {
  border-color: rgba(63, 88, 116, 0.76);
}

.settings-eye-button {
  box-shadow: none;
}

.empty {
  color: var(--rb-brown);
}

@media (max-width: 480px) {
  .collapsed,
  .gpt-restore-chip {
    width: min(160px, calc(100vw - 12px));
    min-width: 152px;
    height: 42px;
    min-height: 42px;
    grid-template-columns: 72px 7px minmax(0, 1fr);
    gap: 3px;
    background:
      linear-gradient(90deg, var(--rb-blue) 0 42px, transparent 42px),
      linear-gradient(180deg, var(--rb-paper-warm), var(--rb-paper-soft));
    padding: 0 6px 0 5px;
  }

  .collapsed::before,
  .gpt-restore-chip::before {
    width: 32px;
  }

  .collapsed::after,
  .gpt-restore-chip::after {
    left: 10px;
    transform: scale(0.76);
    transform-origin: left center;
  }

  .collapsed:hover,
  .gpt-restore-chip:hover {
    background:
      linear-gradient(90deg, #2d405a 0 42px, transparent 42px),
      linear-gradient(180deg, #fffdf7, #f1e9db);
  }

  .collapsed-main {
    column-gap: 3px;
  }

  .collapsed-main::before {
    height: 20px;
  }

  .platform {
    font-size: 9px;
  }

  .primary {
    font-size: 10px;
  }

  .platform-overflow .platform {
    left: -36px;
    right: 40px;
    padding-left: 13px;
  }

  .platform-overflow .platform::before {
    width: 6px;
    height: 6px;
  }

  .capsule-mascot {
    left: 66px;
    bottom: -20px;
    width: 154px;
  }

  .gpt-panel {
    width: min(370px, calc(100vw - 12px));
    height: min(536px, calc(100vh - 14px));
  }

  .gpt-collapsed-panel {
    width: min(350px, calc(100vw - 12px));
    min-height: 62px;
    grid-template-columns: minmax(96px, auto) minmax(42px, 1fr) auto;
    padding-left: 104px;
  }

  .gpt-collapsed-panel .capsule-mascot {
    left: 76px;
    width: 102px;
  }

  .gpt-alerts {
    display: none;
  }
}
`;
  const PLATFORM_LABEL = {
    grok: "Grok",
    claude: "Claude",
    chatgpt: "GPT",
    kimi: "Kimi",
    gemini: "Gemini",
    perplexity: "Perplexity"
  };
  const GPT_SECTION_ORDER = [
    "input",
    "features",
    "windows",
    "codex",
    "other"
  ];
  class UsageWidget {
    constructor(platform2, onRefresh, handlers = {}) {
      this.platform = platform2;
      this.onRefresh = onRefresh;
      this.handlers = handlers;
      this.expanded = false;
      this.hidden = platform2 === "chatgpt";
      this.host.id = "ai-usage-floating-monitor";
      this.host.dataset.platform = platform2;
      const style = document.createElement("style");
      style.textContent = WIDGET_CSS;
      this.shadow.append(style, this.root);
      this.timerId = window.setInterval(() => this.render(), 15e3);
      this.mountWatchId = window.setInterval(() => this.ensureMounted(), 2e3);
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
    ipRiskSettingsDraft = null;
    backoffUntil = 0;
    languageMode = DEFAULT_LANGUAGE_MODE;
    resolvedLanguage = resolveLanguage(DEFAULT_LANGUAGE_MODE);
    timerId;
    mountWatchId;
    mount() {
      this.ensureMounted();
      this.render();
    }
    destroy() {
      window.clearInterval(this.timerId);
      window.clearInterval(this.mountWatchId);
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
    setLanguageMode(value) {
      this.languageMode = value;
      this.resolvedLanguage = resolveLanguage(value);
      this.render();
    }
    text(key, params) {
      return t(this.resolvedLanguage, key, params);
    }
    createIpRiskSettingsDraft() {
      return {
        enabled: this.ipRiskSettings.enabled,
        apiKeyValue: this.ipRiskSettings.apiKeyPreview ?? "",
        keyDirty: false,
        revealKey: false
      };
    }
    closeIpRiskSettingsDialog() {
      this.ipRiskSettingsOpen = false;
      this.ipRiskSettingsDraft = null;
      this.render();
    }
    render() {
      this.ensureMounted();
      if (this.hidden) {
        this.ipRiskSettingsOpen = false;
        this.ipRiskSettingsDraft = null;
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
      if (this.expanded) {
        this.resetPanelPosition();
      }
      this.replaceRootWith(this.expanded ? this.renderPanel() : this.renderCollapsed());
    }
    ensureMounted() {
      if (!this.host.isConnected) {
        document.documentElement.append(this.host);
      }
    }
    replaceRootWith(main) {
      if (this.ipRiskSettingsOpen) {
        this.root.replaceChildren(main, this.renderIpRiskSettingsDialog());
        return;
      }
      this.root.replaceChildren(main);
    }
    schedulePlatformOverflowCheck(button) {
      const platformLabel = button.querySelector(".platform");
      if (!platformLabel) {
        return;
      }
      requestAnimationFrame(() => {
        if (!button.isConnected) {
          return;
        }
        button.classList.remove("platform-overflow");
        const platformName = platformLabel.textContent?.trim() ?? "";
        const overflows = platformLabel.scrollWidth > platformLabel.clientWidth + 1;
        const shouldSitBehindMascot = overflows || platformName.length >= 6;
        button.classList.toggle("platform-overflow", shouldSitBehindMascot);
      });
    }
    renderChatGptRestoreChip() {
      const button = el("button", "gpt-restore-chip");
      button.type = "button";
      this.applyChipPosition();
      button.setAttribute("aria-label", this.text("action.restoreGptPanel"));
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
      this.schedulePlatformOverflowCheck(button);
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
      let suppressPointerClickUntil = 0;
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
        if (moved) {
          suppressPointerClickUntil = Date.now() + 350;
          event.preventDefault();
        }
      };
      button.addEventListener("click", (event) => {
        if (event.detail > 0 && Date.now() < suppressPointerClickUntil) {
          suppressPointerClickUntil = 0;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        suppressPointerClickUntil = 0;
        onActivate();
      });
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
      const title = titleNode("gpt-title", this.text("gpt.title"), "clover-medallion.png");
      const summary = textEl("div", "gpt-collapsed-summary", this.criticalSummary());
      const actions = el("div", "gpt-actions");
      const refresh = this.renderActionButton(
        this.loading ? "..." : "↻",
        this.text("action.refreshUsage"),
        () => this.onRefresh()
      );
      refresh.disabled = this.loading || this.backoffRemainingMs() > 0;
      const expand = this.renderActionButton("+", this.text("action.expandPanel"), () => {
        this.expanded = true;
        this.render();
      });
      const close = this.renderActionButton("×", this.text("action.hidePanel"), () => {
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
      const title = titleNode("title gpt-title", this.text("gpt.title"), "clover-medallion.png");
      const right = el("div", "gpt-header-right");
      right.append(
        textEl("span", "gpt-alerts", this.text("gpt.alertCount", { count: this.alertCount() }))
      );
      const actions = el("div", "actions gpt-actions");
      const refresh = this.renderActionButton(
        this.loading ? "..." : "↻",
        this.text("action.refreshUsage"),
        () => this.onRefresh()
      );
      refresh.disabled = this.loading || this.backoffRemainingMs() > 0;
      const collapse = this.renderActionButton("−", this.text("action.collapsePanel"), () => {
        this.expanded = false;
        this.render();
      });
      const close = this.renderActionButton("×", this.text("action.hidePanel"), () => {
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
          content.append(textEl("div", "empty", this.text("usage.empty")));
        }
        return content;
      }
      for (const section of groupChatGptMeters(meters, this.resolvedLanguage)) {
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
      section.append(sectionTitle(this.text("sentinel.accountStatus"), "leaf-small.png"));
      const gate = el("div", "sentinel-block");
      gate.append(
        this.renderSentinelRow(
          this.text("sentinel.gate"),
          `${formatRiskLabelLocalized(
            this.resolvedLanguage,
            state.sentinelRisk.label
          )} ${state.sentinelRisk.score}/100`
        ),
        this.renderSentinelBar(state.sentinelRisk.score),
        this.renderSentinelRow(
          "PoW",
          `${state.pow.raw ?? "-"} / ${state.pow.level} / ${state.pow.risk}`
        ),
        textEl("div", "sentinel-explanation", this.text("sentinel.explanation"))
      );
      section.append(gate);
      return section;
    }
    renderIpRiskSection() {
      const section = el("section", "meter-section ip-risk-section");
      section.append(cardCorners(), decorativeAsset("shield.png", "section-badge shield-badge"));
      section.append(sectionTitle(this.text("usage.networkRisk"), "leaf-small.png"));
      const block = el("div", "sentinel-block ip-risk-block");
      block.append(this.renderSentinelRow(this.text("ip.check"), this.ipRiskStatusText()));
      const freshIpRisk = this.freshIpRiskState();
      if (freshIpRisk) {
        block.append(
          this.renderSentinelBar(freshIpRisk.score),
          this.renderSentinelRow(
            this.text("ip.signal"),
            formatIpRiskSignals(freshIpRisk, this.resolvedLanguage)
          ),
          this.renderSentinelRow(this.text("ip.source"), freshIpRisk.source)
        );
      } else if (this.ipRiskRefreshing) {
        block.append(textEl("div", "sentinel-explanation", this.text("ip.querying")));
      } else if (this.ipRiskSettings.enabled && this.ipRiskSettings.hasApiKey && this.ipRiskState?.status === "error") {
        block.append(
          textEl(
            "div",
            "sentinel-explanation error-text",
            this.ipRiskState.errorMessage ?? this.text("ip.errorFallback")
          )
        );
      } else {
        block.append(
          textEl(
            "div",
            "sentinel-explanation",
            this.ipRiskSettings.enabled ? this.text("ip.enabledHelp") : this.text("ip.disabledHelp")
          )
        );
      }
      section.append(block);
      return section;
    }
    renderIpRiskSettingsDialog() {
      const panel = el("section", "settings-popover");
      const header = el("div", "settings-header");
      const draft = this.ipRiskSettingsDraft ?? this.createIpRiskSettingsDraft();
      this.ipRiskSettingsDraft = draft;
      header.append(
        titleNode("settings-title", this.text("settings.title"), "shield.png"),
        this.renderActionButton("×", this.text("action.closeSettings"), () => {
          this.closeIpRiskSettingsDialog();
        })
      );
      const languageSelect = document.createElement("select");
      languageSelect.className = "settings-input";
      for (const [value, label] of [
        ["auto", this.text("language.auto")],
        ["zh-CN", this.text("language.zhCN")],
        ["en", this.text("language.en")]
      ]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        languageSelect.append(option);
      }
      languageSelect.value = this.languageMode;
      const enabledInput = document.createElement("input");
      enabledInput.type = "checkbox";
      enabledInput.checked = draft.enabled;
      enabledInput.addEventListener("change", () => {
        draft.enabled = enabledInput.checked;
      });
      const enabledLabel = el("label", "settings-check");
      enabledLabel.append(
        enabledInput,
        textEl("span", "", this.text("ip.enableProxycheck"))
      );
      const keyInputWrap = el("div", "settings-input-wrap");
      const keyInput = document.createElement("input");
      keyInput.className = "settings-input";
      keyInput.type = draft.revealKey ? "text" : "password";
      keyInput.autocomplete = "off";
      keyInput.spellcheck = false;
      keyInput.value = draft.apiKeyValue;
      keyInput.placeholder = draft.keyDirty && this.ipRiskSettings.hasApiKey ? this.text("ip.newKeyPlaceholder") : this.ipRiskSettings.hasApiKey ? this.text("ip.savedKeyPlaceholder") : this.text("ip.keyPlaceholder");
      const prepareKeyEdit = () => {
        if (!draft.keyDirty && this.ipRiskSettings.hasApiKey) {
          draft.keyDirty = true;
          keyInput.value = "";
          keyInput.placeholder = this.text("ip.newKeyPlaceholder");
          keyInput.type = "password";
          draft.revealKey = false;
        }
        draft.apiKeyValue = keyInput.value;
      };
      keyInput.addEventListener("keydown", (event) => {
        if (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete") {
          prepareKeyEdit();
        }
      });
      keyInput.addEventListener("paste", prepareKeyEdit);
      keyInput.addEventListener("input", () => {
        draft.keyDirty = true;
        draft.apiKeyValue = keyInput.value;
        draft.revealKey = keyInput.type !== "password";
      });
      const syncDraft = () => {
        draft.enabled = enabledInput.checked;
        draft.apiKeyValue = keyInput.value;
        draft.revealKey = keyInput.type !== "password";
      };
      languageSelect.addEventListener("change", () => {
        syncDraft();
        const nextMode = languageModeFromValue(languageSelect.value);
        this.languageMode = nextMode;
        this.resolvedLanguage = resolveLanguage(nextMode);
        this.handlers.onLanguageModeSave?.(nextMode);
        this.render();
      });
      const reveal = this.renderActionButton(
        "👁",
        this.text("action.toggleSecret"),
        () => {
          keyInput.type = keyInput.type === "password" ? "text" : "password";
          draft.revealKey = keyInput.type !== "password";
        }
      );
      reveal.classList.add("settings-eye-button");
      keyInputWrap.append(keyInput, reveal);
      const actions = el("div", "settings-actions");
      const save = textEl(
        "button",
        "settings-button primary-button",
        this.text("settings.save")
      );
      save.type = "button";
      save.addEventListener("click", () => {
        draft.enabled = enabledInput.checked;
        draft.apiKeyValue = keyInput.value;
        const inputValue = draft.apiKeyValue.trim();
        const previewValue = this.ipRiskSettings.apiKeyPreview ?? "";
        this.handlers.onIpRiskSettingsSave?.({
          enabled: draft.enabled,
          apiKey: inputValue && inputValue !== previewValue ? inputValue : void 0
        });
        this.closeIpRiskSettingsDialog();
      });
      const refresh = textEl(
        "button",
        "settings-button",
        this.text("settings.checkNow")
      );
      refresh.type = "button";
      refresh.disabled = this.ipRiskRefreshing || !this.ipRiskSettings.enabled || !this.ipRiskSettings.hasApiKey;
      refresh.addEventListener("click", () => {
        this.handlers.onIpRiskRefresh?.();
        this.closeIpRiskSettingsDialog();
      });
      const remove = textEl(
        "button",
        "settings-button danger-button",
        this.text("ip.deleteKey")
      );
      remove.type = "button";
      remove.disabled = !this.ipRiskSettings.hasApiKey;
      remove.addEventListener("click", () => {
        this.handlers.onIpRiskSettingsSave?.({
          enabled: enabledInput.checked,
          clearApiKey: true
        });
        this.closeIpRiskSettingsDialog();
      });
      actions.append(save, refresh, remove);
      panel.append(
        header,
        textEl("label", "settings-label", this.text("language.label")),
        languageSelect,
        enabledLabel,
        textEl("label", "settings-label", this.text("ip.apiKeyLabel")),
        keyInputWrap,
        textEl("div", "settings-help", this.text("ip.help")),
        actions
      );
      return panel;
    }
    ipRiskStatusText() {
      if (!this.ipRiskSettings.enabled) {
        return this.text("ip.status.disabled");
      }
      if (!this.ipRiskSettings.hasApiKey) {
        return this.text("ip.status.missingKey");
      }
      if (this.ipRiskRefreshing) {
        return this.text("ip.status.checking");
      }
      if (this.ipRiskSettings.enabled && this.ipRiskSettings.hasApiKey && this.ipRiskState?.status === "error") {
        return this.text("ip.status.failed");
      }
      const freshIpRisk = this.freshIpRiskState();
      if (freshIpRisk) {
        return `${formatRiskLabelLocalized(
          this.resolvedLanguage,
          freshIpRisk.label
        )} ${freshIpRisk.score}/100`;
      }
      return this.text("ip.status.waiting");
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
      const progress = clampPercent$1(score);
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
      return this.renderActionButton("⚙", this.text("action.settings"), () => {
        this.ipRiskSettingsOpen = !this.ipRiskSettingsOpen;
        if (!this.ipRiskSettingsOpen) {
          this.ipRiskSettingsDraft = null;
        }
        this.render();
      });
    }
    renderCollapsed() {
      const button = el("button", "collapsed");
      button.type = "button";
      button.setAttribute(
        "aria-label",
        this.text("action.openUsage", { platform: PLATFORM_LABEL[this.platform] })
      );
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
      this.schedulePlatformOverflowCheck(button);
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
        this.text("usage.title", { platform: PLATFORM_LABEL[this.platform] }),
        platformTitleAsset(this.platform)
      );
      const actions = el("div", "actions");
      const refresh = textEl("button", "icon-button", this.loading ? "..." : "↻");
      refresh.type = "button";
      refresh.setAttribute("aria-label", this.text("action.refreshUsage"));
      refresh.title = this.text("action.refreshUsage");
      refresh.disabled = this.loading || this.backoffRemainingMs() > 0;
      refresh.addEventListener("click", this.onRefresh);
      const close = textEl("button", "icon-button", "×");
      close.type = "button";
      close.setAttribute("aria-label", this.text("action.collapseWidget"));
      close.title = this.text("action.collapseWidget");
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
      const updated = this.snapshot ? this.text("meta.updatedAt", {
        age: formatAgeLocalized(this.resolvedLanguage, this.snapshot.updatedAt)
      }) : this.text("meta.neverUpdated");
      const right = this.backoffRemainingMs() > 0 ? this.text("meta.waitSeconds", {
        seconds: Math.ceil(this.backoffRemainingMs() / 1e3)
      }) : this.snapshot?.cacheAgeMs !== void 0 ? this.text("meta.cacheSeconds", {
        seconds: Math.floor(this.snapshot.cacheAgeMs / 1e3)
      }) : this.loading ? this.text("meta.loading") : "";
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
      meta.append(textEl("span", "model-label", this.text("model.label")), value);
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
      if (this.platform === "grok" && this.appendGrokCreditsContent(content, meters)) {
        return content;
      }
      for (const meter of meters) {
        content.append(this.renderMeter(meter));
      }
      return content;
    }
    appendGrokCreditsContent(content, meters) {
      const total = meters.find((meter) => meter.rawKind === "grokCreditsConfig:total");
      const products = meters.filter(isGrokCreditsProductMeter).sort(grokCreditsProductCompare);
      if (!total && products.length === 0) {
        return false;
      }
      if (total) {
        content.append(this.renderGrokCreditsMeter(total, products));
      } else {
        for (const product of products) {
          content.append(this.renderMeter(product));
        }
      }
      for (const meter of meters) {
        if (meter !== total && !isGrokCreditsProductMeter(meter)) {
          content.append(this.renderMeter(meter));
        }
      }
      return true;
    }
    renderGrokCreditsMeter(total, products) {
      const row = el("div", "meter grok-credits-meter");
      const top = el("div", "meter-top");
      top.append(
        textEl(
          "div",
          "meter-label",
          formatMeterLabelLocalized(this.resolvedLanguage, total)
        ),
        textEl("div", "meter-value", this.formatUsedPercentValue(total))
      );
      const progress = usedMeterProgress(total);
      const bar = el("div", "bar grok-stack-bar");
      const stack = el("div", "grok-stack-fill");
      const visibleProducts = products.filter((product) => usedMeterProgress(product) > 0);
      if (visibleProducts.length > 0) {
        visibleProducts.forEach((product, index) => {
          const segment = el("span", "grok-stack-segment");
          const value = usedMeterProgress(product);
          segment.style.width = `${value}%`;
          segment.style.background = grokContributionColor(index);
          segment.title = `${formatMeterLabelLocalized(
            this.resolvedLanguage,
            product
          )} ${this.formatUsedPercentValue(product)}`;
          stack.append(segment);
        });
      } else {
        const segment = el("span", "grok-stack-segment");
        segment.style.width = `${progress}%`;
        segment.style.background = grokContributionColor(0);
        stack.append(segment);
      }
      bar.style.setProperty("--meter-progress", `${progress}%`);
      bar.append(stack, decorativeAsset("leaf-small.png", "progress-leaf"));
      const details = el("div", "grok-contribution-list");
      products.forEach((product, index) => {
        const item = el("span", "grok-contribution");
        const dot = el("span", "grok-contribution-dot");
        dot.style.background = grokContributionColor(index);
        item.append(
          dot,
          textEl(
            "span",
            "grok-contribution-label",
            formatMeterLabelLocalized(this.resolvedLanguage, product)
          ),
          textEl("span", "grok-contribution-value", this.formatUsedPercentValue(product))
        );
        details.append(item);
      });
      row.append(top, bar);
      if (products.length > 0) {
        row.append(details);
      }
      row.append(this.renderMeterBottom(total));
      return row;
    }
    renderMeter(meter) {
      const row = el("div", "meter");
      const top = el("div", "meter-top");
      top.append(
        textEl(
          "div",
          "meter-label",
          formatMeterLabelLocalized(this.resolvedLanguage, meter)
        ),
        textEl(
          "div",
          "meter-value",
          formatMeterValueLocalized(this.resolvedLanguage, meter)
        )
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
      row.append(top, bar, this.renderMeterBottom(meter));
      return row;
    }
    renderMeterBottom(meter) {
      const bottom = el("div", "meter-bottom");
      const age = meter.observedAt ? ` · ${formatAgeLocalized(this.resolvedLanguage, meter.observedAt)}` : "";
      bottom.append(
        textEl(
          "span",
          "badge",
          `${formatSourceLabelLocalized(
            this.resolvedLanguage,
            meter.source
          )} · ${formatConfidenceLabelLocalized(
            this.resolvedLanguage,
            meter.confidence
          )}${age}`
        ),
        textEl("span", "", formatResetLocalized(this.resolvedLanguage, meter))
      );
      return bottom;
    }
    formatUsedPercentValue(meter) {
      if (typeof meter.usedPercent === "number") {
        return this.text("meter.usedPercent", {
          percent: Math.round(meter.usedPercent)
        });
      }
      return formatMeterValueLocalized(this.resolvedLanguage, meter);
    }
    primaryValue() {
      const meters = this.snapshot?.meters ?? [];
      const byRemaining = meters.filter((meter) => typeof meter.remaining === "number").sort((a, b) => (a.remaining ?? 0) - (b.remaining ?? 0))[0];
      if (byRemaining?.remaining !== void 0 && byRemaining.remaining !== null) {
        return `${byRemaining.remaining}`;
      }
      const byRemainingPercent = meters.filter((meter) => typeof meter.remainingPercent === "number").sort((a, b) => (a.remainingPercent ?? 0) - (b.remainingPercent ?? 0))[0];
      if (byRemainingPercent?.remainingPercent !== void 0 && byRemainingPercent.remainingPercent !== null) {
        return this.text("meter.remainingPercent", {
          percent: Math.round(byRemainingPercent.remainingPercent)
        });
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
        return formatStatusLabelLocalized(
          this.resolvedLanguage,
          this.snapshot?.status ?? "unknown"
        );
      }
      if (typeof alert.remainingPercent === "number") {
        return `${shortLabel(
          formatMeterLabelLocalized(this.resolvedLanguage, alert)
        )} ${this.text("meter.remainingPercent", {
          percent: Math.round(alert.remainingPercent)
        })}`;
      }
      if (typeof alert.usedPercent === "number") {
        return `${shortLabel(
          formatMeterLabelLocalized(this.resolvedLanguage, alert)
        )} ${Math.round(alert.usedPercent)}%`;
      }
      if (typeof alert.remaining === "number") {
        return `${shortLabel(
          formatMeterLabelLocalized(this.resolvedLanguage, alert)
        )} ${this.text("meter.remaining", { remaining: alert.remaining })}`;
      }
      return shortLabel(formatMeterLabelLocalized(this.resolvedLanguage, alert));
    }
    chatGptMeters() {
      const meters = [...this.snapshot?.meters ?? []];
      return meters.sort((a, b) => chatGptMeterPriority(a) - chatGptMeterPriority(b));
    }
    chatGptPrimaryValue() {
      const meters = this.chatGptMeters();
      const alert = meters.find((meter) => typeof meter.remaining === "number" && meter.remaining <= 0) ?? meters.find((meter) => typeof meter.remainingPercent === "number" && meter.remainingPercent <= 5) ?? meters.filter((meter) => typeof meter.remaining === "number").sort((a, b) => (a.remaining ?? 0) - (b.remaining ?? 0))[0] ?? meters.filter((meter) => typeof meter.remainingPercent === "number").sort((a, b) => (a.remainingPercent ?? 0) - (b.remainingPercent ?? 0))[0] ?? meters.find((meter) => typeof meter.usedPercent === "number");
      return alert ? formatMeterValueLocalized(this.resolvedLanguage, alert) : "?";
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
      if (meter.rawKind?.startsWith("grokCreditsConfig:")) {
        return this.formatUsedPercentValue(meter);
      }
      return formatMeterValueLocalized(this.resolvedLanguage, meter);
    }
    grokPrimaryMeter() {
      const meters = [...this.snapshot?.meters ?? []];
      return meters.sort(
        (a, b) => grokMeterPriority(a) - grokMeterPriority(b) || (b.observedAt ?? 0) - (a.observedAt ?? 0)
      )[0] ?? null;
    }
  }
  function meterProgress(meter) {
    if (typeof meter.remainingPercent === "number") {
      return clampPercent$1(meter.remainingPercent);
    }
    if (typeof meter.usedPercent === "number") {
      return clampPercent$1(meter.usedPercent);
    }
    if (typeof meter.remaining === "number" && typeof meter.total === "number" && meter.total > 0) {
      return clampPercent$1((meter.total - meter.remaining) / meter.total * 100);
    }
    return 0;
  }
  function usedMeterProgress(meter) {
    if (typeof meter.usedPercent === "number") {
      return clampPercent$1(meter.usedPercent);
    }
    return meterProgress(meter);
  }
  function clampPercent$1(value) {
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
  function formatIpRiskSignals(state, language) {
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
    return signals.length > 0 ? signals.join(" / ") : t(language, "ip.noProxySignals");
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
  function groupChatGptMeters(meters, language) {
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
      label: formatGptSectionLabelLocalized(language, key),
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
    if (meter.rawKind === "grokCreditsConfig:total") {
      return 10;
    }
    if (meter.rawKind?.startsWith("grokCreditsConfig:product:")) {
      return 20;
    }
    if (meter.rawKind === "queries") {
      return 40;
    }
    if (meter.rawKind === "highEffortRateLimits") {
      return 50;
    }
    if (meter.rawKind === "lowEffortRateLimits") {
      return 60;
    }
    if (meter.rawKind === "tokens") {
      return 70;
    }
    return 80;
  }
  function isGrokCreditsProductMeter(meter) {
    return Boolean(meter.rawKind?.startsWith("grokCreditsConfig:product:"));
  }
  function grokCreditsProductCompare(a, b) {
    return grokCreditsProductPriority(a) - grokCreditsProductPriority(b);
  }
  function grokCreditsProductPriority(meter) {
    const productId = Number(meter.rawKind?.match(/product:(\d+)/)?.[1] ?? 0);
    const priority = {
      5: 10,
      4: 20,
      1: 30,
      2: 40
    };
    return priority[productId] ?? 90;
  }
  function grokContributionColor(index) {
    return [
      "var(--rb-blue)",
      "var(--rb-blue-soft)",
      "#9fb9e8",
      "#c4d2ef",
      "var(--rb-mustard)"
    ][index % 5];
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
    const path = `assets/little-chihiro/${name}`;
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
    if (platform2 === "kimi") {
      return "leaf-emblem.png";
    }
    if (platform2 === "gemini") {
      return "gem-square.png";
    }
    if (platform2 === "perplexity") {
      return "gem-square.png";
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
    if (hostname === "gemini.google.com") {
      return "gemini";
    }
    if (hostname === "www.kimi.com" || hostname === "kimi.com") {
      return "kimi";
    }
    if (hostname === "www.perplexity.ai" || hostname === "perplexity.ai") {
      return "perplexity";
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
  const FEATURE_LABELS$1 = {
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
        label: FEATURE_LABELS$1[featureName] ?? titleFromKey(featureName),
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
  function responseFailure$4(response) {
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
      requiredFailures.push(responseFailure$4(conversation));
    }
    const wham = await fetcher("chatgpt:whamUsage");
    if (wham.ok) {
      meters.push(...normalizeChatGptWhamUsage(wham.json, "api"));
    } else {
      optionalFailures.push(responseFailure$4(wham));
    }
    const tasks = await fetcher("chatgpt:whamTasksRateLimit");
    if (tasks.ok) {
      meters.push(...normalizeTasksRateLimit(tasks.json, "api"));
    } else {
      optionalFailures.push(responseFailure$4(tasks));
    }
    const codexUsage = await fetcher("chatgpt:codexSettingsUsage");
    if (codexUsage.ok) {
      meters.push(...normalizeChatGptCodexSettingsUsage(codexUsage.json, "api"));
    } else {
      optionalFailures.push(responseFailure$4(codexUsage));
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
  function responseFailure$3(response) {
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
        errorMessage: responseFailure$3(organizations),
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
        errorMessage: responseFailure$3(usage),
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
  const GEMINI_ENDPOINT_KEY = "gemini:usageBatchExecute";
  const GEMINI_USAGE_RPC_ID = "jSf9Qc";
  function parseGeminiBatchExecuteFrames(text) {
    const withoutXssi = text.startsWith(")]}'") ? text.slice(4) : text;
    const frames = [];
    for (const line of withoutXssi.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || /^\d+$/.test(trimmed)) {
        continue;
      }
      frames.push(JSON.parse(trimmed));
    }
    return frames;
  }
  function normalizeGeminiUsageText(text, source = "api") {
    let frames;
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
    let payload;
    try {
      payload = JSON.parse(payloadString);
    } catch {
      return {
        meters: [],
        errorMessage: "Gemini usage payload parse failed"
      };
    }
    const values = asArray(payload);
    const payloadStatus = asNumber(values[0]) ?? void 0;
    const buckets = asArray(values[1]);
    const meters = buckets.map((bucket) => normalizeGeminiBucket(bucket, source)).filter((meter) => meter !== null);
    return {
      meters,
      payloadStatus,
      errorMessage: meters.length === 0 ? "Gemini usage buckets missing" : void 0
    };
  }
  async function fetchGeminiUsage(fetcher) {
    const response = await fetcher(GEMINI_ENDPOINT_KEY);
    if (!response.ok) {
      const missingReplayParams = response.error?.message === "Missing Gemini usage replay parameters";
      return {
        platform: "gemini",
        meters: [],
        source: "unknown",
        updatedAt: Date.now(),
        status: missingReplayParams ? "unknown" : "error",
        errorMessage: missingReplayParams ? "等待 Gemini 页面用量参数" : responseFailure$2(response),
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
        parser: parsed.payloadStatus !== void 0 ? `gemini.status=${parsed.payloadStatus}` : "gemini.batchexecute"
      }
    };
  }
  function normalizeGeminiBucket(value, source) {
    const bucket = asArray(value);
    const remaining = asNumber(bucket[0]);
    const ratio = asNumber(bucket[1]);
    const type = asNumber(bucket[2]);
    const resetAt = resetAtFromBucket(bucket[3]);
    if (remaining === null || ratio === null || type === null) {
      return null;
    }
    const usedPercent = percentFromRatioOrPercent(ratio);
    const remainingPercent = usedPercent === null ? null : clampPercent(100 - usedPercent);
    const total = ratio >= 0 && ratio < 1 ? Math.round(remaining / (1 - ratio)) : null;
    const label = labelForBucketType(type);
    return {
      key: keyForBucketType(type),
      label,
      remaining,
      total,
      used: total !== null ? Math.max(0, Math.round(total - remaining)) : null,
      usedPercent,
      remainingPercent,
      resetAt,
      windowSeconds: windowSecondsForBucketType(type),
      source,
      confidence: resetAt !== null ? "high" : "medium",
      rawKind: `type:${type}`
    };
  }
  function resetAtFromBucket(value) {
    const timestamp = asArray(asArray(value)[0]);
    const sec = asNumber(timestamp[0]);
    const nano = asNumber(timestamp[1]) ?? 0;
    if (sec === null) {
      return null;
    }
    return Math.round((sec + nano / 1e9) * 1e3);
  }
  function clampPercent(value) {
    return Math.max(0, Math.min(100, value));
  }
  function labelForBucketType(type) {
    if (type === 1) {
      return "Gemini 5h";
    }
    if (type === 2) {
      return "Gemini weekly";
    }
    return `Gemini bucket ${type}`;
  }
  function keyForBucketType(type) {
    if (type === 1) {
      return "gemini:5h";
    }
    if (type === 2) {
      return "gemini:weekly";
    }
    return `gemini:type-${type}`;
  }
  function windowSecondsForBucketType(type) {
    if (type === 1) {
      return 5 * 60 * 60;
    }
    if (type === 2) {
      return 7 * 24 * 60 * 60;
    }
    return null;
  }
  function findWrbPayloadString(value) {
    if (Array.isArray(value)) {
      if (value[0] === "wrb.fr" && value[1] === GEMINI_USAGE_RPC_ID && typeof value[2] === "string") {
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
  function findGeminiErrorStatus(value) {
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
  function responseFailure$2(response) {
    return formatUsageError(
      usageErrorFromBridge(response),
      response.endpointKey ?? "gemini"
    );
  }
  const GROK_ENDPOINT_KEY = "grok:credits-config";
  const GRPC_WEB_DATA_FRAME = 0;
  const USAGE_PERIOD_LABELS = {
    1: "monthly",
    2: "weekly"
  };
  const PRODUCT_LABELS = {
    1: "Grok Build",
    2: "API",
    4: "Chat",
    5: "Imagine",
    6: "Build",
    7: "Voice",
    8: "API"
  };
  function normalizeGrokCreditsConfig(base64Text, options = {}) {
    const config = parseGrokCreditsConfig(base64Text);
    if (!config) {
      return [];
    }
    const source = options.source ?? "api";
    const resetAt = config.currentPeriod?.end ?? null;
    const period = config.currentPeriod?.type ?? "current";
    const meters = [];
    const validProductUsage = config.productUsage.filter(
      (item) => Number.isFinite(item.usagePercent)
    );
    if (config.creditUsagePercent !== null || validProductUsage.length > 0) {
      const rawUsedPercent = validProductUsage.length > 0 ? validProductUsage.reduce((sum, item) => sum + item.usagePercent, 0) : config.creditUsagePercent ?? 0;
      const usedPercent = percentFromGrokPercent(rawUsedPercent);
      meters.push({
        key: `grok:${period}:total`,
        label: `${titleCase(period)} Grok limit`,
        usedPercent,
        resetAt,
        source,
        confidence: resetAt ? "high" : "medium",
        rawKind: "grokCreditsConfig:total"
      });
    }
    for (const item of config.productUsage) {
      const label = PRODUCT_LABELS[item.product] ?? `Product ${item.product}`;
      const usedPercent = percentFromGrokPercent(item.usagePercent);
      if (usedPercent === null) {
        continue;
      }
      meters.push({
        key: `grok:${period}:${label.toLowerCase().replace(/\s+/g, "-")}`,
        label,
        usedPercent,
        resetAt,
        source,
        confidence: resetAt ? "high" : "medium",
        rawKind: `grokCreditsConfig:product:${item.product}`
      });
    }
    return meters;
  }
  function responseFailure$1(response) {
    return formatUsageError(
      usageErrorFromBridge(response),
      response.endpointKey ?? "grok"
    );
  }
  async function fetchGrokUsage(fetcher) {
    const response = await fetcher(GROK_ENDPOINT_KEY);
    const meters = response.ok ? normalizeGrokCreditsConfig(response.text, { source: "api" }) : [];
    const failure = response.ok ? void 0 : responseFailure$1(response);
    return {
      platform: "grok",
      meters,
      source: meters.length > 0 ? "api" : "unknown",
      updatedAt: Date.now(),
      status: meters.length > 0 ? "ok" : failure ? "error" : "unknown",
      errorMessage: failure,
      debug: {
        endpoint: GROK_ENDPOINT_KEY,
        parser: "grok.creditsConfig.grpcWeb"
      }
    };
  }
  function parseGrokCreditsConfig(base64Text) {
    if (!base64Text) {
      return null;
    }
    let message;
    try {
      message = firstGrpcWebMessage(base64ToBytes(base64Text));
    } catch {
      return null;
    }
    if (!message) {
      return null;
    }
    const rootConfig = fields(message).find(
      (field) => field.field === 1 && field.wireType === 2
    );
    if (!rootConfig?.bytes) {
      return null;
    }
    let creditUsagePercent = null;
    let currentPeriod = null;
    const productUsage = [];
    for (const field of fields(rootConfig.bytes)) {
      if (field.field === 1 && field.wireType === 5) {
        creditUsagePercent = finiteNumber(field.float);
      } else if (field.field === 7 && field.wireType === 2 && field.bytes) {
        const item = parseProductUsage(field.bytes);
        if (item) {
          productUsage.push(item);
        }
      } else if (field.field === 8 && field.wireType === 2 && field.bytes) {
        currentPeriod = parseCurrentPeriod(field.bytes);
      }
    }
    if (creditUsagePercent === null && productUsage.length === 0) {
      return null;
    }
    return {
      creditUsagePercent,
      currentPeriod,
      productUsage
    };
  }
  function parseProductUsage(bytes) {
    let product = null;
    let usagePercent = null;
    for (const field of fields(bytes)) {
      if (field.field === 1 && field.wireType === 0 && field.varint !== void 0) {
        product = Number(field.varint);
      } else if (field.field === 2 && field.wireType === 5) {
        usagePercent = finiteNumber(field.float);
      }
    }
    if (product === null || usagePercent === null) {
      return null;
    }
    return { product, usagePercent };
  }
  function parseCurrentPeriod(bytes) {
    let type = "unspecified";
    let start2 = null;
    let end = null;
    for (const field of fields(bytes)) {
      if (field.field === 1 && field.wireType === 0 && field.varint !== void 0) {
        type = USAGE_PERIOD_LABELS[Number(field.varint)] ?? "unspecified";
      } else if (field.field === 2 && field.wireType === 2 && field.bytes) {
        start2 = parseTimestamp(field.bytes);
      } else if (field.field === 3 && field.wireType === 2 && field.bytes) {
        end = parseTimestamp(field.bytes);
      }
    }
    return { type, start: start2, end };
  }
  function parseTimestamp(bytes) {
    let seconds = null;
    let nanos = 0;
    for (const field of fields(bytes)) {
      if (field.field === 1 && field.wireType === 0 && field.varint !== void 0) {
        seconds = field.varint;
      } else if (field.field === 2 && field.wireType === 0 && field.varint !== void 0) {
        nanos = Number(field.varint);
      }
    }
    if (seconds === null) {
      return null;
    }
    const millis = Number(seconds) * 1e3 + Math.floor(nanos / 1e6);
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  function firstGrpcWebMessage(bytes) {
    let offset = 0;
    while (offset + 5 <= bytes.length) {
      const flag = bytes[offset];
      const length = readUint32Be(bytes, offset + 1);
      const start2 = offset + 5;
      const end = start2 + length;
      if (end > bytes.length) {
        return null;
      }
      if (flag === GRPC_WEB_DATA_FRAME) {
        return bytes.slice(start2, end);
      }
      offset = end;
    }
    return null;
  }
  function fields(bytes) {
    const result = [];
    let offset = 0;
    while (offset < bytes.length) {
      const key = readVarint(bytes, offset);
      if (!key) {
        break;
      }
      offset = key.offset;
      const field = Number(key.value >> 3n);
      const wireType = Number(key.value & 7n);
      if (field <= 0) {
        break;
      }
      if (wireType === 0) {
        const value = readVarint(bytes, offset);
        if (!value) {
          break;
        }
        offset = value.offset;
        result.push({ field, wireType, varint: value.value });
      } else if (wireType === 2) {
        const length = readVarint(bytes, offset);
        if (!length) {
          break;
        }
        offset = length.offset;
        const end = offset + Number(length.value);
        if (end > bytes.length) {
          break;
        }
        result.push({ field, wireType, bytes: bytes.slice(offset, end) });
        offset = end;
      } else if (wireType === 5) {
        if (offset + 4 > bytes.length) {
          break;
        }
        result.push({
          field,
          wireType,
          float: new DataView(
            bytes.buffer,
            bytes.byteOffset + offset,
            4
          ).getFloat32(0, true)
        });
        offset += 4;
      } else {
        break;
      }
    }
    return result;
  }
  function readVarint(bytes, offset) {
    let value = 0n;
    let shift = 0n;
    let cursor = offset;
    while (cursor < bytes.length) {
      const byte = BigInt(bytes[cursor]);
      cursor += 1;
      value |= (byte & 0x7fn) << shift;
      if ((byte & 0x80n) === 0n) {
        return { value, offset: cursor };
      }
      shift += 7n;
      if (shift > 63n) {
        return null;
      }
    }
    return null;
  }
  function readUint32Be(bytes, offset) {
    return bytes[offset] * 16777216 + bytes[offset + 1] * 65536 + bytes[offset + 2] * 256 + bytes[offset + 3];
  }
  function base64ToBytes(value) {
    const binary = atob(value.replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  function percentFromGrokPercent(value) {
    if (!Number.isFinite(value)) {
      return null;
    }
    return Math.max(0, Math.min(100, value));
  }
  function titleCase(value) {
    return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
  }
  const FEATURE_LABELS = {
    FEATURE_OMNI: "Credit"
  };
  function parseDateToTimestamp(value) {
    const str = typeof value === "string" ? value : null;
    if (!str) {
      return null;
    }
    const date = new Date(str);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.getTime();
  }
  function normalizeKimiUsage(json, source = "api") {
    const root = asRecord(json);
    if (!root) {
      return [];
    }
    const balances = asArray(root.balances);
    const subscription = asRecord(root.subscription);
    const meters = [];
    let planTitle = null;
    if (subscription) {
      const goods = getRecord(subscription, "goods");
      planTitle = goods ? getString(goods, "title") : null;
    }
    for (const item of balances) {
      const record = asRecord(item);
      if (!record) {
        continue;
      }
      const feature = getString(record, "feature") ?? "unknown";
      const usedRatio = getNumber(record, "amountUsedRatio");
      const expireTime = parseDateToTimestamp(record.expireTime);
      if (usedRatio === null) {
        continue;
      }
      const usedPercent = usedRatio >= 0 && usedRatio <= 1 ? usedRatio * 100 : usedRatio;
      const remainingPercent = Math.max(0, Math.min(100, 100 - usedPercent));
      meters.push({
        key: feature.toLowerCase().replace(/^feature_/, ""),
        label: planTitle ?? FEATURE_LABELS[feature] ?? feature,
        usedPercent,
        remainingPercent,
        resetAt: expireTime,
        source,
        confidence: "high",
        rawKind: feature
      });
    }
    return meters;
  }
  async function fetchKimiUsage() {
    return {
      platform: "kimi",
      meters: [],
      source: "unknown",
      updatedAt: Date.now(),
      status: "unknown"
    };
  }
  const PERPLEXITY_ENDPOINT_KEY = "perplexity:rateLimitAll";
  const FIELD_METERS = [
    {
      field: "remaining_pro",
      key: "perplexity:pro",
      label: "Pro"
    },
    {
      field: "remaining_research",
      key: "perplexity:research",
      label: "Deep Research"
    },
    {
      field: "remaining_labs",
      key: "perplexity:labs",
      label: "Labs"
    },
    {
      field: "remaining_agentic_research",
      key: "perplexity:agentic-research",
      label: "Agentic Research"
    },
    {
      field: "free_queries",
      key: "perplexity:free-queries",
      label: "Free queries"
    }
  ];
  function normalizePerplexityRateLimit(json, source = "api") {
    const root = asRecord(json);
    if (!root) {
      return [];
    }
    const meters = FIELD_METERS.flatMap((definition) => {
      const remaining = getNumber(root, definition.field);
      return remaining === null ? [] : [
        makeRemainingMeter({
          key: definition.key,
          label: definition.label,
          remaining,
          source,
          rawKind: definition.field
        })
      ];
    });
    meters.push(...normalizeModelSpecificLimits(root.model_specific_limits, source));
    return meters;
  }
  async function fetchPerplexityUsage(fetcher) {
    const response = await fetcher(PERPLEXITY_ENDPOINT_KEY);
    if (!response.ok) {
      return {
        platform: "perplexity",
        meters: [],
        source: "unknown",
        updatedAt: Date.now(),
        status: "error",
        errorMessage: responseFailure(response),
        debug: {
          endpoint: PERPLEXITY_ENDPOINT_KEY,
          parser: "perplexity.rateLimitAll"
        }
      };
    }
    const meters = normalizePerplexityRateLimit(response.json, "api");
    return {
      platform: "perplexity",
      meters,
      source: meters.length > 0 ? "api" : "unknown",
      updatedAt: Date.now(),
      status: meters.length > 0 ? "ok" : "error",
      errorMessage: meters.length > 0 ? void 0 : "Perplexity rate-limit fields missing",
      debug: {
        endpoint: PERPLEXITY_ENDPOINT_KEY,
        parser: "perplexity.rateLimitAll"
      }
    };
  }
  function normalizeModelSpecificLimits(value, source) {
    const limits = asRecord(value);
    if (!limits) {
      return [];
    }
    const meters = [];
    for (const [modelName, rawLimit] of Object.entries(limits)) {
      const limit = asRecord(rawLimit);
      if (!limit) {
        continue;
      }
      const remaining = getNumber(limit, "remaining") ?? getNumber(limit, "remaining_queries") ?? getNumber(limit, "remainingQueries");
      const total = getNumber(limit, "limit") ?? getNumber(limit, "total") ?? getNumber(limit, "total_queries") ?? getNumber(limit, "totalQueries");
      if (remaining === null) {
        continue;
      }
      meters.push(
        makeRemainingMeter({
          key: `perplexity:model:${modelName}`,
          label: `${titleFromKey(modelName)} model limit`,
          modelName,
          remaining,
          total,
          source,
          rawKind: `model_specific_limits.${modelName}`
        })
      );
    }
    return meters;
  }
  function makeRemainingMeter(args) {
    const total = args.total ?? null;
    const used = args.remaining !== null && total !== null ? Math.max(0, total - args.remaining) : null;
    const usedPercent = used !== null && total !== null && total > 0 ? used / total * 100 : null;
    const remainingPercent = args.remaining !== null && total !== null && total > 0 ? Math.max(0, Math.min(100, args.remaining / total * 100)) : null;
    return {
      key: args.key,
      label: args.label,
      modelName: args.modelName,
      remaining: args.remaining,
      total,
      used,
      usedPercent,
      remainingPercent,
      source: args.source,
      confidence: total !== null ? "high" : "medium",
      rawKind: args.rawKind
    };
  }
  function responseFailure(response) {
    return formatUsageError(
      usageErrorFromBridge(response),
      response.endpointKey ?? "perplexity"
    );
  }
  function fetchPlatformUsage(platform2, fetcher) {
    if (platform2 === "grok") {
      return fetchGrokUsage(fetcher);
    }
    if (platform2 === "claude") {
      return fetchClaudeUsage(fetcher);
    }
    if (platform2 === "kimi") {
      return fetchKimiUsage();
    }
    if (platform2 === "gemini") {
      return fetchGeminiUsage(fetcher);
    }
    if (platform2 === "perplexity") {
      return fetchPerplexityUsage(fetcher);
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
      return normalizeGrokCreditsConfig(args.text, { source: "intercepted" });
    }
    if (args.platform === "claude") {
      return normalizeClaudeUsage(args.json, "intercepted");
    }
    if (args.platform === "kimi") {
      return normalizeKimiUsage(args.json, "intercepted");
    }
    if (args.platform === "gemini") {
      return typeof args.text === "string" ? normalizeGeminiUsageText(args.text, "intercepted").meters : [];
    }
    if (args.platform === "perplexity") {
      return normalizePerplexityRateLimit(args.json, "intercepted");
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
    const items = await storageGet$2(STATE_KEY);
    const value = items[STATE_KEY];
    return isChatGptSentinelState(value) ? value : null;
  }
  async function rememberChatGptSentinelObservation(observation, state) {
    if (containsForbiddenSentinelKey(observation) || containsForbiddenSentinelKey(state)) {
      return;
    }
    const existing = await getChatGptSentinelObservations();
    const observations = [observation, ...existing].slice(0, OBSERVATION_LIMIT);
    await storageSet$2({
      [STATE_KEY]: state,
      [OBSERVATIONS_KEY]: observations
    });
  }
  async function getChatGptSentinelObservations() {
    const items = await storageGet$2(OBSERVATIONS_KEY);
    const value = items[OBSERVATIONS_KEY];
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter(isChatGptSentinelObservation).slice(0, OBSERVATION_LIMIT);
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
    const items = await storageGet$1(IP_RISK_SETTINGS_KEY);
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
    await storageSet$1({ [IP_RISK_SETTINGS_KEY]: next });
    return publicIpRiskSettings(next);
  }
  async function getIpRiskState() {
    const items = await storageGet$1(IP_RISK_STATE_KEY);
    const state = items[IP_RISK_STATE_KEY];
    return isIpRiskState(state) ? state : null;
  }
  function setIpRiskState(state) {
    return storageSet$1({ [IP_RISK_STATE_KEY]: state });
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
  const LANGUAGE_SETTINGS_KEY = "aiUsage:language";
  async function getLanguageMode() {
    const items = await storageGet(LANGUAGE_SETTINGS_KEY);
    return languageModeFromStorageValue(items[LANGUAGE_SETTINGS_KEY]);
  }
  async function saveLanguageMode(mode) {
    const next = languageModeFromValue(mode);
    await storageSet({ [LANGUAGE_SETTINGS_KEY]: next });
    return next;
  }
  function languageModeFromStorageValue(value) {
    return languageModeFromValue(value);
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
  if (platform && shouldStartOnThisFrame(platform) && !window.__AI_USAGE_FLOATING_MONITOR_CONTENT__) {
    window.__AI_USAGE_FLOATING_MONITOR_CONTENT__ = true;
    void start(platform);
  }
  function shouldStartOnThisFrame(platformId) {
    if (window.top === window) {
      return true;
    }
    if (platformId !== "perplexity") {
      return false;
    }
    return window.innerWidth >= 640 && window.innerHeight >= 480;
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
    const saveLanguage = async (mode) => {
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
          void saveIpRisk(update).catch((error) => {
            debugLog("failed to save IP risk settings", error);
          });
        },
        onLanguageModeSave: (mode) => {
          void saveLanguage(mode).catch((error) => {
            debugLog("failed to save language settings", error);
          });
        }
      }
    );
    widget.mount();
    widget.setLanguageMode(await getLanguageMode());
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
