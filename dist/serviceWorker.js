(function() {
  "use strict";
  const DEFAULT_IP_RISK_PUBLIC_SETTINGS = {
    enabled: false
  };
  const PUBLIC_IP_URL = "https://api64.ipify.org/?format=json";
  function proxycheckRequestUrl(apiKey, ipAddress) {
    const url = new URL(
      `https://proxycheck.io/v2/${encodeURIComponent(ipAddress)}`
    );
    url.searchParams.set("key", apiKey);
    url.searchParams.set("vpn", "1");
    url.searchParams.set("risk", "1");
    return url.toString();
  }
  async function fetchCurrentPublicIp(fetcher = fetch) {
    const response = await fetcher(PUBLIC_IP_URL, {
      method: "GET",
      cache: "no-store",
      credentials: "omit"
    });
    if (!response.ok) {
      throw new Error(`公网 IP 查询失败 HTTP ${response.status}`);
    }
    const json = await response.json();
    const ip = typeof json?.ip === "string" ? json.ip.trim() : "";
    if (!isIpLiteral(ip)) {
      throw new Error("公网 IP 查询返回格式无效");
    }
    return ip;
  }
  async function fetchProxycheckIpRisk(apiKey, fetcher = fetch, now = Date.now()) {
    const ipAddress = await fetchCurrentPublicIp(fetcher);
    const response = await fetcher(proxycheckRequestUrl(apiKey, ipAddress), {
      method: "GET",
      cache: "no-store",
      credentials: "omit"
    });
    if (!response.ok) {
      throw new Error(`proxycheck.io HTTP ${response.status}`);
    }
    return normalizeProxycheckResponse(await response.json(), now);
  }
  function normalizeProxycheckResponse(value, now = Date.now()) {
    const root = asRecord(value);
    if (!root) {
      throw new Error("proxycheck.io 返回格式无效");
    }
    const status = stringValue(root.status)?.toLowerCase() ?? "";
    if (status === "denied" || status === "error") {
      throw new Error(
        stringValue(root.message) ?? stringValue(root.error) ?? "proxycheck.io 拒绝了本次查询"
      );
    }
    const entry = findProxycheckEntry(root);
    if (!entry) {
      throw new Error("proxycheck.io 未返回 IP 风险条目");
    }
    const type = cleanString(entry.type);
    const typeLower = type?.toLowerCase() ?? "";
    const score = scoreValue(entry.risk ?? entry.risk_score ?? entry.score);
    const proxy = yes(entry.proxy) || typeLower.includes("proxy");
    const vpn = yes(entry.vpn) || typeLower.includes("vpn");
    const tor = yes(entry.tor) || typeLower.includes("tor");
    const hosting = yes(entry.hosting) || yes(entry.datacenter) || typeLower.includes("hosting") || typeLower.includes("data center") || typeLower.includes("datacenter");
    return {
      provider: "proxycheck",
      source: "proxycheck.io",
      status: "ok",
      updatedAt: now,
      score,
      label: ipRiskLabel(score),
      signals: {
        proxy,
        vpn,
        tor,
        hosting,
        type
      }
    };
  }
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
  function errorIpRiskState(message, now = Date.now()) {
    return {
      provider: "proxycheck",
      source: "proxycheck.io",
      status: "error",
      updatedAt: now,
      score: null,
      label: "未知",
      signals: emptySignals(),
      errorMessage: message
    };
  }
  function ipRiskLabel(score) {
    if (typeof score !== "number") {
      return "未知";
    }
    if (score >= 75) {
      return "严重";
    }
    if (score >= 50) {
      return "高";
    }
    if (score >= 25) {
      return "偏高";
    }
    return "正常";
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
  function findProxycheckEntry(root) {
    const hintedIp = stringValue(root.ip);
    if (hintedIp) {
      const hinted = asRecord(root[hintedIp]);
      if (hinted) {
        return hinted;
      }
    }
    for (const [key, value] of Object.entries(root)) {
      if (key === "status" || key === "ip" || key === "message" || key === "query time") {
        continue;
      }
      const entry = asRecord(value);
      if (entry && ("risk" in entry || "proxy" in entry || "type" in entry)) {
        return entry;
      }
    }
    return null;
  }
  function scoreValue(value) {
    const numeric = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
    if (!Number.isFinite(numeric)) {
      return null;
    }
    return Math.max(0, Math.min(100, Math.round(numeric)));
  }
  function yes(value) {
    if (value === true || value === 1) {
      return true;
    }
    if (typeof value !== "string") {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "yes" || normalized === "true" || normalized === "1";
  }
  function cleanString(value) {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, 64) : null;
  }
  function stringValue(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
  function asRecord(value) {
    return typeof value === "object" && value !== null ? value : null;
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
  function isIpLiteral(value) {
    return /^[0-9]{1,3}(?:\.[0-9]{1,3}){3}$/.test(value) || /^[0-9a-f:]+$/i.test(value);
  }
  const IP_RISK_SETTINGS_KEY = "aiUsage:ipRisk:settings";
  const IP_RISK_STATE_KEY = "aiUsage:ipRisk:state";
  async function getStoredIpRiskSettings() {
    const items = await storageGet(IP_RISK_SETTINGS_KEY);
    return storedIpRiskSettingsFromValue(items[IP_RISK_SETTINGS_KEY]);
  }
  function setIpRiskState(state) {
    return storageSet({ [IP_RISK_STATE_KEY]: state });
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
  const PERPLEXITY_URL_PATTERN = /^https:\/\/(?:www\.)?perplexity\.ai\//;
  const PERPLEXITY_MATCHES = [
    "https://perplexity.ai/*",
    "https://www.perplexity.ai/*"
  ];
  const PERPLEXITY_DYNAMIC_SCRIPT_IDS = [
    "ratebucket-perplexity-main-world-bridge",
    "ratebucket-perplexity-content"
  ];
  const PERPLEXITY_INJECTION_COOLDOWN_MS = 3e3;
  const PERPLEXITY_INJECTION_RETRY_DELAYS_MS = [1500, 5e3];
  const PERPLEXITY_INJECTION_DEBUG_KEY = "aiUsage:perplexity:injectionDebug";
  const perplexityInjectionAttempts = /* @__PURE__ */ new Map();
  let perplexitySetupQueue = Promise.resolve();
  queuePerplexityCometFallback("serviceWorkerStart");
  chrome.runtime.onInstalled.addListener(() => {
    queuePerplexityCometFallback("runtimeInstalled");
  });
  chrome.runtime.onStartup.addListener(() => {
    queuePerplexityCometFallback("runtimeStartup");
  });
  chrome.action.onClicked.addListener((tab) => {
    void injectPerplexityTabFromAction(tab);
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = changeInfo.url ?? tab.url;
    if (!url || !PERPLEXITY_URL_PATTERN.test(url)) {
      return;
    }
    if (changeInfo.status !== "complete" && changeInfo.url === void 0) {
      return;
    }
    schedulePerplexityContentFallback(tabId, url, "tabUpdated");
  });
  chrome.tabs.onActivated.addListener((activeInfo) => {
    void injectActivePerplexityTab(activeInfo.tabId, "tabActivated");
  });
  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
      if (message?.type === "AI_USAGE_IP_RISK_REFRESH") {
        refreshIpRisk().then((state) => {
          sendResponse({
            ok: state.status !== "error",
            state,
            ...state.errorMessage ? { error: state.errorMessage } : {}
          });
        }).catch((error) => {
          const state = errorIpRiskState(
            error instanceof Error ? error.message : "IP 风险检测失败"
          );
          void setIpRiskState(state);
          sendResponse({ ok: false, error: state.errorMessage, state });
        });
        return true;
      }
      if (message?.type !== "AI_USAGE_INJECT_MAIN_WORLD") {
        return false;
      }
      const tabId = sender.tab?.id;
      if (typeof tabId !== "number") {
        sendResponse({ ok: false, error: "Missing sender tab id" });
        return false;
      }
      const target = {
        tabId,
        ...typeof sender.frameId === "number" ? { frameIds: [sender.frameId] } : {}
      };
      chrome.scripting.executeScript({
        target,
        files: ["mainWorldBridge.js"],
        world: "MAIN"
      }).then(() => sendResponse({ ok: true })).catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Injection failed"
        });
      });
      return true;
    }
  );
  async function injectPerplexityContentFallback(tabId, url, reason, force = false) {
    const now = Date.now();
    const previous = perplexityInjectionAttempts.get(tabId);
    const key = normalizedPerplexityInjectionKey(url);
    if (!force && previous?.key === key && now - previous.attemptedAt < PERPLEXITY_INJECTION_COOLDOWN_MS) {
      return;
    }
    perplexityInjectionAttempts.set(tabId, { key, attemptedAt: now });
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
        injectImmediately: true
      });
      await rememberPerplexityInjectionDebug({
        ok: true,
        reason,
        tabId,
        url: key
      });
    } catch (error) {
      await rememberPerplexityInjectionDebug({
        ok: false,
        reason,
        tabId,
        url: key,
        error: error instanceof Error ? error.message : "Perplexity injection failed"
      });
      return;
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["content.js"],
        injectImmediately: true
      });
    } catch {
    }
  }
  async function setupPerplexityCometFallback(reason) {
    await registerPerplexityDynamicContentScripts(reason);
    await injectOpenPerplexityTabs(reason);
  }
  function queuePerplexityCometFallback(reason) {
    perplexitySetupQueue = perplexitySetupQueue.then(() => setupPerplexityCometFallback(reason)).catch(
      (error) => rememberPerplexityInjectionDebug({
        ok: false,
        reason: `${reason}:setup`,
        error: error instanceof Error ? error.message : "Perplexity fallback setup failed"
      })
    );
  }
  async function registerPerplexityDynamicContentScripts(reason) {
    try {
      await chrome.scripting.unregisterContentScripts({
        ids: [...PERPLEXITY_DYNAMIC_SCRIPT_IDS]
      });
    } catch {
    }
    try {
      await chrome.scripting.registerContentScripts([
        {
          id: PERPLEXITY_DYNAMIC_SCRIPT_IDS[0],
          matches: [...PERPLEXITY_MATCHES],
          js: ["mainWorldBridge.js"],
          runAt: "document_start",
          allFrames: true,
          matchOriginAsFallback: true,
          persistAcrossSessions: true,
          world: "MAIN"
        },
        {
          id: PERPLEXITY_DYNAMIC_SCRIPT_IDS[1],
          matches: [...PERPLEXITY_MATCHES],
          js: ["content.js"],
          runAt: "document_start",
          allFrames: true,
          matchOriginAsFallback: true,
          persistAcrossSessions: true
        }
      ]);
      await rememberPerplexityInjectionDebug({
        ok: true,
        reason: `${reason}:registerContentScripts`
      });
    } catch (error) {
      await rememberPerplexityInjectionDebug({
        ok: false,
        reason: `${reason}:registerContentScripts`,
        error: error instanceof Error ? error.message : "Perplexity dynamic content script registration failed"
      });
    }
  }
  async function injectOpenPerplexityTabs(reason) {
    try {
      const tabs = await chrome.tabs.query({ url: [...PERPLEXITY_MATCHES] });
      await Promise.all(
        tabs.map((tab) => {
          if (typeof tab.id !== "number" || !tab.url) {
            return Promise.resolve();
          }
          schedulePerplexityContentFallback(tab.id, tab.url, `${reason}:openTab`);
          return Promise.resolve();
        })
      );
    } catch (error) {
      await rememberPerplexityInjectionDebug({
        ok: false,
        reason: `${reason}:queryOpenTabs`,
        error: error instanceof Error ? error.message : "Perplexity tab query failed"
      });
    }
  }
  async function injectActivePerplexityTab(tabId, reason) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url || !PERPLEXITY_URL_PATTERN.test(tab.url)) {
        return;
      }
      schedulePerplexityContentFallback(tabId, tab.url, reason);
    } catch (error) {
      await rememberPerplexityInjectionDebug({
        ok: false,
        reason,
        tabId,
        error: error instanceof Error ? error.message : "Perplexity active tab lookup failed"
      });
    }
  }
  async function injectPerplexityTabFromAction(tab) {
    if (typeof tab.id !== "number") {
      await rememberPerplexityInjectionDebug({
        ok: false,
        reason: "actionClicked",
        error: "Missing active tab id"
      });
      return;
    }
    if (!tab.url || !PERPLEXITY_URL_PATTERN.test(tab.url)) {
      await rememberPerplexityInjectionDebug({
        ok: false,
        reason: "actionClicked",
        tabId: tab.id,
        url: tab.url,
        error: "Active tab is not a Perplexity page"
      });
      return;
    }
    schedulePerplexityContentFallback(tab.id, tab.url, "actionClicked");
  }
  function schedulePerplexityContentFallback(tabId, url, reason) {
    void injectPerplexityContentFallback(tabId, url, reason);
    for (const delay of PERPLEXITY_INJECTION_RETRY_DELAYS_MS) {
      setTimeout(() => {
        void injectPerplexityContentFallback(
          tabId,
          url,
          `${reason}:retry:${delay}`,
          true
        );
      }, delay);
    }
  }
  async function rememberPerplexityInjectionDebug(args) {
    try {
      await chrome.storage.local.set({
        [PERPLEXITY_INJECTION_DEBUG_KEY]: {
          ...args,
          updatedAt: Date.now()
        }
      });
    } catch {
    }
  }
  function normalizedPerplexityInjectionKey(rawUrl) {
    try {
      const url = new URL(rawUrl);
      return `${url.origin}${url.pathname}`;
    } catch {
      return rawUrl;
    }
  }
  async function refreshIpRisk() {
    const settings = await getStoredIpRiskSettings();
    let state;
    if (!settings.enabled) {
      state = disabledIpRiskState();
    } else if (!settings.proxycheckApiKey) {
      state = missingKeyIpRiskState();
    } else {
      try {
        state = await fetchProxycheckIpRisk(settings.proxycheckApiKey);
      } catch (error) {
        state = errorIpRiskState(
          error instanceof Error ? error.message : "proxycheck.io 查询失败"
        );
      }
    }
    await setIpRiskState(state);
    return state;
  }
})();
