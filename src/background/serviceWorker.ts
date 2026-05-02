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

type BackgroundRequest = {
  type?: string;
};

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

    chrome.scripting
      .executeScript({
        target: { tabId },
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
