(function() {
  "use strict";
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
      chrome.scripting.executeScript({
        target: { tabId },
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
})();
