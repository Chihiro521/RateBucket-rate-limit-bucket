import {
  disabledIpRiskState,
  errorIpRiskState,
  fetchProxycheckIpRisk,
  missingKeyIpRiskState,
  type IpRiskState
} from "../platforms/ipRisk";
import {
  getStoredIpRiskSettings,
  setIpRiskState
} from "../storage/ipRisk";

const PERPLEXITY_URL_PATTERN = /^https:\/\/(?:www\.)?perplexity\.ai\//;
const PERPLEXITY_MATCHES = [
  "https://perplexity.ai/*",
  "https://www.perplexity.ai/*"
] as const;
const PERPLEXITY_DYNAMIC_SCRIPT_IDS = [
  "ratebucket-perplexity-main-world-bridge",
  "ratebucket-perplexity-content"
] as const;
const PERPLEXITY_INJECTION_COOLDOWN_MS = 3_000;
const PERPLEXITY_INJECTION_RETRY_DELAYS_MS = [1_500, 5_000] as const;
const PERPLEXITY_INJECTION_DEBUG_KEY = "aiUsage:perplexity:injectionDebug";
const perplexityInjectionAttempts = new Map<number, {
  key: string;
  attemptedAt: number;
}>();
let perplexitySetupQueue = Promise.resolve();

type BackgroundRequest = {
  type?: string;
};

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
  if (changeInfo.status !== "complete" && changeInfo.url === undefined) {
    return;
  }
  schedulePerplexityContentFallback(tabId, url, "tabUpdated");
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void injectActivePerplexityTab(activeInfo.tabId, "tabActivated");
});

chrome.runtime.onMessage.addListener(
  (
    message: BackgroundRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: { ok: boolean; error?: string; state?: IpRiskState }) => void
  ) => {
    if (message?.type === "AI_USAGE_IP_RISK_REFRESH") {
      refreshIpRisk()
        .then((state) => {
          sendResponse({
            ok: state.status !== "error",
            state,
            ...(state.errorMessage ? { error: state.errorMessage } : {})
          });
        })
        .catch((error: unknown) => {
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
    const target: chrome.scripting.InjectionTarget = {
      tabId,
      ...(typeof sender.frameId === "number" ? { frameIds: [sender.frameId] } : {})
    };

    chrome.scripting
      .executeScript({
        target,
        files: ["mainWorldBridge.js"],
        world: "MAIN"
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Injection failed"
        });
      });

    return true;
  }
);

async function injectPerplexityContentFallback(
  tabId: number,
  url: string,
  reason: string,
  force = false
): Promise<void> {
  const now = Date.now();
  const previous = perplexityInjectionAttempts.get(tabId);
  const key = normalizedPerplexityInjectionKey(url);
  if (
    !force &&
    previous?.key === key &&
    now - previous.attemptedAt < PERPLEXITY_INJECTION_COOLDOWN_MS
  ) {
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
    // Cross-origin telemetry frames may reject all-frame injection; top frame already ran.
  }
}

async function setupPerplexityCometFallback(reason: string): Promise<void> {
  await registerPerplexityDynamicContentScripts(reason);
  await injectOpenPerplexityTabs(reason);
}

function queuePerplexityCometFallback(reason: string): void {
  perplexitySetupQueue = perplexitySetupQueue
    .then(() => setupPerplexityCometFallback(reason))
    .catch((error: unknown) =>
      rememberPerplexityInjectionDebug({
        ok: false,
        reason: `${reason}:setup`,
        error:
          error instanceof Error
            ? error.message
            : "Perplexity fallback setup failed"
      })
    );
}

async function registerPerplexityDynamicContentScripts(
  reason: string
): Promise<void> {
  try {
    await chrome.scripting.unregisterContentScripts({
      ids: [...PERPLEXITY_DYNAMIC_SCRIPT_IDS]
    });
  } catch {
    // Nothing to unregister in fresh installs or older Chromium variants.
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
      error:
        error instanceof Error
          ? error.message
          : "Perplexity dynamic content script registration failed"
    });
  }
}

async function injectOpenPerplexityTabs(reason: string): Promise<void> {
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
      error:
        error instanceof Error ? error.message : "Perplexity tab query failed"
    });
  }
}

async function injectActivePerplexityTab(
  tabId: number,
  reason: string
): Promise<void> {
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
      error:
        error instanceof Error ? error.message : "Perplexity active tab lookup failed"
    });
  }
}

async function injectPerplexityTabFromAction(tab: chrome.tabs.Tab): Promise<void> {
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

function schedulePerplexityContentFallback(
  tabId: number,
  url: string,
  reason: string
): void {
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

async function rememberPerplexityInjectionDebug(args: {
  ok: boolean;
  reason: string;
  tabId?: number;
  url?: string;
  error?: string;
}): Promise<void> {
  try {
    await chrome.storage.local.set({
      [PERPLEXITY_INJECTION_DEBUG_KEY]: {
        ...args,
        updatedAt: Date.now()
      }
    });
  } catch {
    // Debug logging must never affect extension behavior.
  }
}

function normalizedPerplexityInjectionKey(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return rawUrl;
  }
}

async function refreshIpRisk(): Promise<IpRiskState> {
  const settings = await getStoredIpRiskSettings();
  let state: IpRiskState;

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
