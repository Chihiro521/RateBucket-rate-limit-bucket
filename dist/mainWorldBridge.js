(function() {
  "use strict";
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function asRecord(value) {
    return isRecord(value) ? value : null;
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
  function getNumber(record, key) {
    return asNumber(record[key]);
  }
  function getString(record, key) {
    return asString(record[key]);
  }
  const CHATGPT_SENTINEL_EVENT = "__AIQM_SENTINEL_EVENT__";
  const CHAT_REQUIREMENTS_RE = /(?:^|\/)(?:backend-api|backend-anon|api)\/sentinel\/chat-requirements(?:\/prepare)?(?:\/?$|[?#])/i;
  function chatRequirementsUrlKind(rawUrl) {
    const normalized = safeUrlPathWithSearch(rawUrl);
    if (!CHAT_REQUIREMENTS_RE.test(normalized)) {
      return null;
    }
    return /\/prepare(?:\/?$|[?#])/i.test(normalized) ? "prepare" : "chat-requirements";
  }
  function sanitizeSentinelResponse(data, rawUrl, now = Date.now()) {
    const urlKind = chatRequirementsUrlKind(rawUrl);
    if (!urlKind) {
      return null;
    }
    const dataRecord = asRecord(data);
    if (!dataRecord) {
      return null;
    }
    const root = asRecord(dataRecord.chat_requirements) ?? asRecord(dataRecord.requirements) ?? dataRecord;
    const pow = asRecord(root.proofofwork) ?? asRecord(root.proof_of_work) ?? asRecord(root.pow);
    return sanitizeSentinelObservation({
      source: "chatgpt-sentinel",
      ts: now,
      urlKind,
      powRequired: pow ? asBoolean(pow.required) === true : false,
      powDifficulty: pow ? getString(pow, "difficulty") : null
    });
  }
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
  function safeUrlPathWithSearch(rawUrl) {
    try {
      const url = new URL(rawUrl, "https://chatgpt.com");
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return rawUrl;
    }
  }
  function installChatGptSentinelHook() {
    if (window.__AI_USAGE_FLOATING_MONITOR_SENTINEL_PATCHED__) {
      return;
    }
    if (!isChatGptHost(window.location.hostname)) {
      return;
    }
    window.__AI_USAGE_FLOATING_MONITOR_SENTINEL_PATCHED__ = true;
    installFetchHook();
    installXhrHook();
  }
  function installFetchHook() {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const rawUrl = requestUrl$1(input);
      const shouldObserve = rawUrl ? chatRequirementsUrlKind(rawUrl) !== null : false;
      const response = await originalFetch(input, init);
      if (shouldObserve && rawUrl) {
        observeFetchResponse(rawUrl, response);
      }
      return response;
    };
  }
  function observeFetchResponse(rawUrl, response) {
    response.clone().json().then((json) => {
      dispatchSanitizedObservation(rawUrl, json);
    }).catch(() => void 0);
  }
  function installXhrHook() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const callOriginalOpen = originalOpen;
    const observedUrls = /* @__PURE__ */ new WeakMap();
    function patchedOpen(method, url, async, username, password) {
      const rawUrl = xhrOpenUrl(url);
      if (rawUrl && chatRequirementsUrlKind(rawUrl)) {
        observedUrls.set(this, rawUrl);
      } else {
        observedUrls.delete(this);
      }
      if (async === void 0) {
        return callOriginalOpen.call(this, method, url);
      }
      return callOriginalOpen.call(this, method, url, async, username, password);
    }
    XMLHttpRequest.prototype.open = patchedOpen;
    XMLHttpRequest.prototype.send = function(...args) {
      const rawUrl = observedUrls.get(this);
      if (rawUrl) {
        this.addEventListener(
          "loadend",
          () => {
            observeXhrResponse(rawUrl, this);
          },
          { once: true }
        );
      }
      return originalSend.apply(this, args);
    };
  }
  function observeXhrResponse(rawUrl, xhr) {
    try {
      if (xhr.responseType === "json") {
        dispatchSanitizedObservation(rawUrl, xhr.response);
        return;
      }
      if (xhr.responseType !== "" && xhr.responseType !== "text") {
        return;
      }
      const text = xhr.responseText;
      if (!text) {
        return;
      }
      dispatchSanitizedObservation(rawUrl, JSON.parse(text));
    } catch {
    }
  }
  function dispatchSanitizedObservation(rawUrl, json) {
    const observation = sanitizeSentinelResponse(json, rawUrl);
    if (!observation) {
      return;
    }
    window.dispatchEvent(
      new CustomEvent(CHATGPT_SENTINEL_EVENT, {
        detail: observation
      })
    );
  }
  function requestUrl$1(input) {
    try {
      if (typeof input === "string") {
        return input;
      }
      if (input instanceof URL) {
        return input.href;
      }
      return input.url;
    } catch {
      return null;
    }
  }
  function xhrOpenUrl(url) {
    if (typeof url === "string") {
      return url;
    }
    if (url instanceof URL) {
      return url.href;
    }
    return null;
  }
  function isChatGptHost(hostname) {
    return hostname === "chatgpt.com" || hostname.endsWith(".chatgpt.com");
  }
  const SOURCE = "ai-usage-floating-monitor";
  function isBridgeRequest(value) {
    return isRecord(value) && value.source === SOURCE && value.direction === "content-to-main" && typeof value.requestId === "string" && typeof value.action === "string" && typeof value.platform === "string";
  }
  const FETCH_TIMEOUT_MS = 1e4;
  if (!window.__AI_USAGE_FLOATING_MONITOR_BRIDGE__) {
    window.__AI_USAGE_FLOATING_MONITOR_BRIDGE__ = true;
    installChatGptSentinelHook();
    installFetchIntercept();
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.origin !== window.location.origin) {
        return;
      }
      if (!isBridgeRequest(event.data)) {
        return;
      }
      void handleRequest(event.data);
    });
  }
  async function handleRequest(request) {
    if (request.action === "enableIntercept") {
      installFetchIntercept();
      postResponse({
        source: SOURCE,
        direction: "main-to-content",
        requestId: request.requestId,
        ok: true,
        platform: request.platform
      });
      return;
    }
    if (!request.endpointKey) {
      postResponse({
        source: SOURCE,
        direction: "main-to-content",
        requestId: request.requestId,
        ok: false,
        platform: request.platform,
        error: { message: "Missing endpointKey" }
      });
      return;
    }
    const endpoint = resolveEndpoint(request.platform, request.endpointKey, request.payload);
    if (!endpoint) {
      postResponse({
        source: SOURCE,
        direction: "main-to-content",
        requestId: request.requestId,
        ok: false,
        platform: request.platform,
        endpointKey: request.endpointKey,
        error: { message: "Endpoint is not allowed" }
      });
      return;
    }
    const response = await fetchJson(endpoint, request.requestId, request.endpointKey);
    postResponse(response);
  }
  function resolveEndpoint(platform, endpointKey, payload) {
    const endpoints = {
      "claude:organizations": {
        platform: "claude",
        method: "GET",
        url: "https://claude.ai/api/organizations"
      },
      "chatgpt:conversationInit": {
        platform: "chatgpt",
        method: "POST",
        url: "https://chatgpt.com/backend-api/conversation/init",
        body: {}
      },
      "chatgpt:whamUsage": {
        platform: "chatgpt",
        method: "GET",
        url: "https://chatgpt.com/backend-api/wham/usage"
      },
      "chatgpt:whamTasksRateLimit": {
        platform: "chatgpt",
        method: "GET",
        url: "https://chatgpt.com/backend-api/wham/tasks/rate_limit"
      },
      "chatgpt:codexSettingsUsage": {
        platform: "chatgpt",
        method: "GET",
        url: "https://chatgpt.com/codex/settings/usage"
      }
    };
    if (endpointKey === "grok:rate-limits") {
      if (platform !== "grok") {
        return null;
      }
      const payloadRecord = asRecord(payload);
      const modelName = payloadRecord ? getString(payloadRecord, "modelName") : null;
      const requestKind = (payloadRecord ? getString(payloadRecord, "requestKind") : null) ?? "DEFAULT";
      if (!isSafeGrokModelName(modelName) || !isSafeGrokRequestKind(requestKind)) {
        return null;
      }
      return {
        platform: "grok",
        method: "POST",
        url: "https://grok.com/rest/rate-limits",
        body: {
          requestKind,
          modelName
        }
      };
    }
    if (endpointKey === "claude:usage") {
      const payloadRecord = asRecord(payload);
      const orgId = payloadRecord ? getString(payloadRecord, "orgId") : null;
      if (!orgId || !/^[A-Za-z0-9_-]{6,}$/.test(orgId)) {
        return null;
      }
      return {
        platform: "claude",
        method: "GET",
        url: `https://claude.ai/api/organizations/${encodeURIComponent(orgId)}/usage`
      };
    }
    const endpoint = endpoints[endpointKey];
    if (!endpoint || endpoint.platform !== platform) {
      return null;
    }
    return endpoint;
  }
  async function fetchJson(endpoint, requestId, endpointKey) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint.url, {
        method: endpoint.method,
        credentials: "include",
        headers: endpoint.body === void 0 ? void 0 : {
          "Content-Type": "application/json"
        },
        body: endpoint.body === void 0 ? void 0 : JSON.stringify(endpoint.body),
        signal: controller.signal
      });
      if (!response.ok) {
        return {
          source: SOURCE,
          direction: "main-to-content",
          requestId,
          ok: false,
          platform: endpoint.platform,
          endpointKey,
          error: {
            status: response.status,
            message: response.statusText || "Usage endpoint failed"
          }
        };
      }
      let json;
      try {
        json = await response.json();
      } catch {
        return {
          source: SOURCE,
          direction: "main-to-content",
          requestId,
          ok: false,
          platform: endpoint.platform,
          endpointKey,
          error: {
            status: response.status,
            message: "响应结构变化"
          }
        };
      }
      return {
        source: SOURCE,
        direction: "main-to-content",
        requestId,
        ok: true,
        platform: endpoint.platform,
        endpointKey,
        json
      };
    } catch (error) {
      return {
        source: SOURCE,
        direction: "main-to-content",
        requestId,
        ok: false,
        platform: endpoint.platform,
        endpointKey,
        error: {
          message: error instanceof Error ? error.message : "Network error"
        }
      };
    } finally {
      window.clearTimeout(timeoutId);
    }
  }
  function installFetchIntercept() {
    if (window.__AI_USAGE_FLOATING_MONITOR_FETCH_PATCHED__) {
      return;
    }
    window.__AI_USAGE_FLOATING_MONITOR_FETCH_PATCHED__ = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const usageRequest = getUsageRequest(input, init);
      const response = await originalFetch(input, init);
      try {
        if (usageRequest) {
          response.clone().json().then(async (json) => {
            const usageContext = await usageRequest.usageContext;
            postInterceptedUsage({
              platform: usageRequest.platform,
              endpointKey: usageRequest.endpointKey,
              url: usageRequest.url,
              usageContext,
              json
            });
          }).catch(() => void 0);
        }
      } catch {
      }
      return response;
    };
  }
  function isSafeGrokModelName(value) {
    return value !== null && /^[A-Za-z0-9._:-]{1,120}$/.test(value);
  }
  function isSafeGrokRequestKind(value) {
    return value !== null && /^[A-Z_]{1,40}$/.test(value);
  }
  function getUsageRequest(input, init) {
    let rawUrl;
    try {
      rawUrl = requestUrl(input);
    } catch {
      return null;
    }
    const info = usageUrlInfo(rawUrl);
    if (!info) {
      return null;
    }
    return {
      platform: info.platform,
      endpointKey: info.endpointKey,
      url: sanitizeUrl(rawUrl),
      usageContext: info.platform === "grok" ? grokRequestContext(input, init) : void 0
    };
  }
  function grokRequestContext(input, init) {
    if (init?.body !== void 0) {
      return usageContextFromBody(init.body);
    }
    if (input instanceof Request && !input.bodyUsed) {
      return input.clone().text().then(usageContextFromText).catch(() => void 0);
    }
    return void 0;
  }
  function usageContextFromBody(body) {
    if (typeof body === "string") {
      return usageContextFromText(body);
    }
    if (body instanceof URLSearchParams) {
      return usageContextFromText(body.toString());
    }
    if (body instanceof FormData) {
      return usageContextFromRecord({
        modelName: body.get("modelName"),
        requestKind: body.get("requestKind")
      });
    }
    if (body instanceof Blob) {
      return body.text().then(usageContextFromText).catch(() => void 0);
    }
    return void 0;
  }
  function usageContextFromText(text) {
    if (!text.trim()) {
      return void 0;
    }
    try {
      return usageContextFromRecord(JSON.parse(text));
    } catch {
      try {
        const params = new URLSearchParams(text);
        return usageContextFromRecord({
          modelName: params.get("modelName"),
          requestKind: params.get("requestKind")
        });
      } catch {
        return void 0;
      }
    }
  }
  function usageContextFromRecord(value) {
    const record = asRecord(value);
    if (!record) {
      return void 0;
    }
    const modelName = getString(record, "modelName") ?? getString(record, "model") ?? getString(record, "modelId");
    const requestKind = getString(record, "requestKind") ?? getString(record, "kind") ?? getString(record, "mode");
    if (!modelName && !requestKind) {
      return void 0;
    }
    return {
      modelName: modelName ?? void 0,
      requestKind: requestKind ?? void 0
    };
  }
  function postInterceptedUsage(args) {
    const message = {
      source: SOURCE,
      direction: "main-to-content",
      kind: "interceptedUsage",
      platform: args.platform,
      endpointKey: args.endpointKey,
      url: args.url,
      usageContext: args.usageContext,
      json: args.json,
      ts: Date.now()
    };
    window.postMessage(message, window.location.origin);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, window.location.origin);
    }
  }
  function requestUrl(input) {
    if (typeof input === "string") {
      return input;
    }
    if (input instanceof URL) {
      return input.href;
    }
    return input.url;
  }
  function usageUrlInfo(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl, window.location.origin);
    } catch {
      return null;
    }
    if (url.origin === "https://grok.com" && url.pathname === "/rest/rate-limits") {
      return { platform: "grok", endpointKey: "grok:rate-limits" };
    }
    if (url.origin === "https://claude.ai" && /^\/api\/organizations\/[^/]+\/usage$/.test(url.pathname)) {
      return { platform: "claude", endpointKey: "claude:usage" };
    }
    if (url.origin === "https://chatgpt.com") {
      if (url.pathname === "/backend-api/conversation/init") {
        return { platform: "chatgpt", endpointKey: "chatgpt:conversationInit" };
      }
      if (url.pathname === "/backend-api/wham/usage") {
        return { platform: "chatgpt", endpointKey: "chatgpt:whamUsage" };
      }
      if (url.pathname === "/backend-api/wham/tasks/rate_limit") {
        return {
          platform: "chatgpt",
          endpointKey: "chatgpt:whamTasksRateLimit"
        };
      }
      if (url.pathname === "/codex/settings/usage") {
        return {
          platform: "chatgpt",
          endpointKey: "chatgpt:codexSettingsUsage"
        };
      }
    }
    return null;
  }
  function sanitizeUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, window.location.origin);
      return `${url.origin}${url.pathname}`;
    } catch {
      return "";
    }
  }
  function postResponse(response) {
    window.postMessage(response, window.location.origin);
  }
})();
