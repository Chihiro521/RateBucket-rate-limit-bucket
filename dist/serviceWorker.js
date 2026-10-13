(function() {
  "use strict";
  async function migrateRetiredFeatures(storage) {
    const migrations = [
      { key: "aiUsage:migration:quota-v2", removedKeys: [
        "aiUsage:ipRisk:settings",
        "aiUsage:ipRisk:state",
        "aiUsage:chatgpt:snapshot",
        "aiUsage:chatgpt:lastRefreshAt",
        "aiUsage:chatgpt:backoffUntil",
        "aiUsage:chatgpt:failureCount"
      ] },
      { key: "aiUsage:migration:retire-account-status-v1", removedKeys: [
        "aiUsage:chatgpt:sentinelState",
        "aiUsage:chatgpt:sentinelObservations"
      ] }
    ];
    for (const { key, removedKeys } of migrations) {
      if ((await storage.get(key))[key]) continue;
      await storage.remove(removedKeys);
      await storage.set({ [key]: true });
    }
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
  void migrateRetiredFeatures(chrome.storage.local).catch(() => void 0);
})();
