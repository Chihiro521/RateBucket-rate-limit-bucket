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
  const GEMINI_USAGE_RPC_ID = "jSf9Qc";
  const geminiBatchExecuteState = {};
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
        error: {
          message: request.endpointKey === "gemini:usageBatchExecute" ? "Missing Gemini usage replay parameters" : "Endpoint is not allowed"
        }
      });
      return;
    }
    const response = await fetchEndpoint(endpoint, request.requestId, request.endpointKey);
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
      },
      "kimi:subscription": {
        platform: "kimi",
        method: "POST",
        url: "https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscription",
        body: {}
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
    if (endpointKey === "gemini:usageBatchExecute") {
      if (platform !== "gemini") {
        return null;
      }
      return resolveGeminiUsageEndpoint();
    }
    const endpoint = endpoints[endpointKey];
    if (!endpoint || endpoint.platform !== platform) {
      return null;
    }
    return endpoint;
  }
  function resolveGeminiUsageEndpoint() {
    const params = currentGeminiReplayParams();
    if (!params) {
      return null;
    }
    const authPath = params.authuser === "0" ? "" : `/u/${params.authuser}`;
    const url = new URL(
      `https://gemini.google.com${authPath}/_/BardChatUi/data/batchexecute`
    );
    url.searchParams.set("rpcids", GEMINI_USAGE_RPC_ID);
    url.searchParams.set(
      "source-path",
      params.authuser === "0" ? "/usage" : `/u/${params.authuser}/usage`
    );
    url.searchParams.set("bl", params.bl);
    url.searchParams.set("f.sid", params.fSid);
    url.searchParams.set("hl", params.hl);
    url.searchParams.set("_reqid", params.reqid);
    url.searchParams.set("rt", params.rt);
    url.searchParams.set("authuser", params.authuser);
    const body = new URLSearchParams();
    body.set("f.req", JSON.stringify([[[GEMINI_USAGE_RPC_ID, "[]", null, "generic"]]]));
    body.set("at", params.at);
    return {
      platform: "gemini",
      method: "POST",
      url: url.toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "x-goog-authuser": params.authuser
      },
      body: `${body.toString()}&`,
      responseType: "text"
    };
  }
  function currentGeminiReplayParams() {
    const wiz = readGeminiWizGlobalData();
    const at = geminiBatchExecuteState.at ?? wiz.at;
    const bl = geminiBatchExecuteState.bl ?? wiz.bl;
    const fSid = geminiBatchExecuteState.fSid ?? wiz.fSid;
    const authuser = geminiBatchExecuteState.authuser ?? currentGeminiAuthUser();
    if (!at || !bl || !fSid || !authuser) {
      return null;
    }
    return {
      at,
      bl,
      fSid,
      reqid: nextGeminiReqid(geminiBatchExecuteState.reqid),
      rt: geminiBatchExecuteState.rt ?? "c",
      hl: geminiBatchExecuteState.hl ?? pageLanguage(),
      authuser
    };
  }
  function readGeminiWizGlobalData() {
    const data = asRecord(window.WIZ_global_data);
    if (!data) {
      return {};
    }
    return {
      at: getString(data, "SNlM0e") ?? void 0,
      fSid: getString(data, "FdrFJe") ?? void 0,
      bl: getString(data, "cfb2h") ?? void 0
    };
  }
  function nextGeminiReqid(value) {
    const parsed = value ? Number(value) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
      return String(Math.floor(parsed) + 1e5);
    }
    return String(1e5 + Math.floor(Date.now() % 9e4));
  }
  function endpointHeaders(endpoint) {
    if (endpoint.headers) {
      return endpoint.headers;
    }
    if (endpoint.body === void 0) {
      return void 0;
    }
    return {
      "Content-Type": "application/json"
    };
  }
  function endpointBody(endpoint) {
    if (endpoint.body === void 0) {
      return void 0;
    }
    if (typeof endpoint.body === "string") {
      return endpoint.body;
    }
    return JSON.stringify(endpoint.body);
  }
  async function fetchEndpoint(endpoint, requestId, endpointKey) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint.url, {
        method: endpoint.method,
        credentials: "include",
        headers: endpointHeaders(endpoint),
        body: endpointBody(endpoint),
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
      if (endpoint.responseType === "text") {
        return {
          source: SOURCE,
          direction: "main-to-content",
          requestId,
          ok: true,
          platform: endpoint.platform,
          endpointKey,
          text: await response.text()
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
    function makePatchedFetch() {
      return async (input, init) => {
        rememberGeminiBatchExecuteRequest(input, init);
        const usageRequest = getUsageRequest(input, init);
        const response = await originalFetch(input, init);
        try {
          if (usageRequest) {
            const text = await response.text();
            const newResponse = new Response(text, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers
            });
            let json;
            try {
              json = JSON.parse(text);
            } catch {
            }
            const usageContext = await usageRequest.usageContext;
            postInterceptedUsage({
              platform: usageRequest.platform,
              endpointKey: usageRequest.endpointKey,
              url: usageRequest.url,
              usageContext,
              json,
              text: usageRequest.responseType === "text" ? text : void 0
            });
            return newResponse;
          }
        } catch {
        }
        return response;
      };
    }
    var currentPatchedFetch = makePatchedFetch();
    window.fetch = currentPatchedFetch;
    window.setInterval(() => {
      if (window.fetch !== currentPatchedFetch) {
        currentPatchedFetch = makePatchedFetch();
        window.fetch = currentPatchedFetch;
      }
    }, 2e3);
  }
  function isSafeGrokModelName(value) {
    return value !== null && /^[A-Za-z0-9._:-]{1,120}$/.test(value);
  }
  function isSafeGrokRequestKind(value) {
    return value !== null && /^[A-Z_]{1,40}$/.test(value);
  }
  function rememberGeminiBatchExecuteRequest(input, init) {
    let rawUrl;
    try {
      rawUrl = requestUrl(input);
    } catch {
      return;
    }
    let url;
    try {
      url = new URL(rawUrl, window.location.origin);
    } catch {
      return;
    }
    if (!isGeminiBatchExecuteUrl(url)) {
      return;
    }
    const authuser = resolveGeminiAuthUser(
      url,
      requestHeaderValue(input, init, "x-goog-authuser")
    );
    if (!hasGeminiUsageRpcId(url.searchParams.get("rpcids"))) {
      rememberGeminiBatchExecuteMetadata(url, authuser);
      return;
    }
    const bodyText = requestBodyText(input, init);
    if (bodyText instanceof Promise) {
      void bodyText.then((text) => {
        rememberGeminiBatchExecuteMetadata(url, authuser, text);
      });
      return;
    }
    rememberGeminiBatchExecuteMetadata(url, authuser, bodyText);
  }
  function rememberGeminiBatchExecuteMetadata(url, authuser, bodyText) {
    setGeminiStateValue("bl", url.searchParams.get("bl"));
    setGeminiStateValue("fSid", url.searchParams.get("f.sid"));
    setGeminiStateValue("reqid", url.searchParams.get("_reqid"));
    setGeminiStateValue("rt", url.searchParams.get("rt"));
    setGeminiStateValue("hl", url.searchParams.get("hl"));
    geminiBatchExecuteState.authuser = authuser;
    if (bodyText) {
      try {
        const params = new URLSearchParams(bodyText);
        setGeminiStateValue("at", params.get("at"));
      } catch {
      }
    }
  }
  function setGeminiStateValue(key, value) {
    if (value) {
      geminiBatchExecuteState[key] = value;
    }
  }
  function requestBodyText(input, init) {
    if (init?.body !== void 0) {
      return bodyTextFromBody(init.body);
    }
    if (input instanceof Request && !input.bodyUsed) {
      return input.clone().text().then((text) => text || void 0).catch(() => void 0);
    }
    return void 0;
  }
  function bodyTextFromBody(body) {
    if (typeof body === "string") {
      return body;
    }
    if (body instanceof URLSearchParams) {
      return body.toString();
    }
    if (body instanceof FormData) {
      const params = new URLSearchParams();
      body.forEach((value, key) => {
        if (typeof value === "string") {
          params.append(key, value);
        }
      });
      return params.toString();
    }
    if (body instanceof Blob) {
      return body.text().then((text) => text || void 0).catch(() => void 0);
    }
    return void 0;
  }
  function requestHeaderValue(input, init, name) {
    return headerValue(init?.headers, name) ?? (input instanceof Request ? input.headers.get(name) : null);
  }
  function headerValue(headers, name) {
    if (!headers) {
      return null;
    }
    const normalizedName = name.toLowerCase();
    if (headers instanceof Headers) {
      return headers.get(name);
    }
    if (Array.isArray(headers)) {
      const pair = headers.find(([key]) => key.toLowerCase() === normalizedName);
      return pair?.[1] ?? null;
    }
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === normalizedName) {
        return value;
      }
    }
    return null;
  }
  function currentGeminiAuthUser() {
    return resolveGeminiAuthUser();
  }
  function resolveGeminiAuthUser(url, headerAuthuser) {
    return sanitizeGeminiAuthUser(headerAuthuser) ?? sanitizeGeminiAuthUser(url?.searchParams.get("authuser")) ?? sanitizeGeminiAuthUser(currentPageUrl().searchParams.get("authuser")) ?? authUserFromPath(window.location.pathname) ?? "0";
  }
  function currentPageUrl() {
    try {
      return new URL(window.location.href);
    } catch {
      return new URL("https://gemini.google.com/");
    }
  }
  function sanitizeGeminiAuthUser(value) {
    return value && /^\d{1,3}$/.test(value) ? value : null;
  }
  function authUserFromPath(pathname) {
    const match = /^\/u\/(\d{1,3})(?:\/|$)/.exec(pathname);
    return match?.[1] ?? null;
  }
  function pageLanguage() {
    const language = document.documentElement.lang || navigator.language || "zh-CN";
    return /^[A-Za-z0-9_-]{2,20}$/.test(language) ? language : "zh-CN";
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
      responseType: info.responseType,
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
      text: args.text,
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
    if (url.origin === "https://www.kimi.com" && url.pathname === "/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscription") {
      return { platform: "kimi", endpointKey: "kimi:subscription" };
    }
    if (isGeminiBatchExecuteUrl(url) && hasGeminiUsageRpcId(url.searchParams.get("rpcids"))) {
      return {
        platform: "gemini",
        endpointKey: "gemini:usageBatchExecute",
        responseType: "text"
      };
    }
    return null;
  }
  function isGeminiBatchExecuteUrl(url) {
    return url.origin === "https://gemini.google.com" && /^\/(?:u\/\d{1,3}\/)?_\/BardChatUi\/data\/batchexecute$/.test(url.pathname);
  }
  function hasGeminiUsageRpcId(value) {
    return value?.split(",").includes(GEMINI_USAGE_RPC_ID) ?? false;
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
