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
  function getRecord(record, key) {
    return asRecord(record[key]);
  }
  function getString(record, key) {
    return asString(record[key]);
  }
  class ChatGptSession {
    constructor(fetcher, changed, now = Date.now) {
      this.fetcher = fetcher;
      this.changed = changed;
      this.now = now;
    }
    cached;
    flight;
    account;
    accountKnown = false;
    user;
    epoch = 0;
    observeAccount(value) {
      if (value === null) return;
      const account = value.trim() || void 0;
      if (this.accountKnown && account === this.account) return;
      this.account = account;
      this.accountKnown = true;
      this.invalidate();
      this.changed();
    }
    invalidate() {
      this.epoch++;
      this.cached = void 0;
      this.flight = void 0;
    }
    async observeSession(json) {
      const root = asRecord(json);
      const user = root ? getRecord(root, "user") : null;
      const id = user ? getString(user, "id") ?? void 0 : void 0;
      if (id && this.user && id !== this.user) {
        this.user = id;
        this.account = void 0;
        this.accountKnown = false;
        this.invalidate();
        this.changed();
      }
    }
    scope() {
      return this.cached?.scopeKey;
    }
    read() {
      if (this.cached && this.cached.expires > this.now()) return Promise.resolve(this.cached);
      if (this.flight) return this.flight;
      const epoch = this.epoch;
      const account = this.account;
      const accountKnown = this.accountKnown;
      const flight = (async () => {
        const response = await this.fetcher("https://chatgpt.com/api/auth/session", { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(1e4) });
        const root = response.ok ? asRecord(await response.json()) : null;
        const token = root ? getString(root, "accessToken") ?? getString(root, "access_token") : null;
        if (!token) throw new Error("ChatGPT session unavailable");
        const userRecord = root ? getRecord(root, "user") : null;
        const user = userRecord ? getString(userRecord, "id") ?? void 0 : void 0;
        if (epoch !== this.epoch) throw new Error("Account context changed");
        if (user && this.user && user !== this.user) {
          this.user = user;
          this.account = void 0;
          this.accountKnown = false;
          this.invalidate();
          this.changed();
          throw new Error("Account context changed");
        }
        this.user = user;
        const scopeKey = user && accountKnown ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${user}|${account ?? "personal"}`)))).map((byte) => byte.toString(16).padStart(2, "0")).join("") : void 0;
        if (epoch !== this.epoch) throw new Error("Account context changed");
        const result = { token, user, account, scopeKey, expires: this.now() + 6e4 };
        this.cached = result;
        return result;
      })();
      this.flight = flight;
      void flight.finally(() => {
        if (this.flight === flight) this.flight = void 0;
      }).catch(() => void 0);
      return flight;
    }
  }
  const SOURCE = "ai-usage-floating-monitor";
  function isBridgeRequest(value) {
    return isRecord(value) && value.source === SOURCE && value.direction === "content-to-main" && typeof value.requestId === "string" && typeof value.action === "string" && typeof value.platform === "string";
  }
  const FETCH_TIMEOUT_MS = 1e4;
  const ownedFetch = window.fetch.bind(window);
  const chatGptControllers = /* @__PURE__ */ new Set();
  const chatGptSession = new ChatGptSession(ownedFetch, () => {
    for (const controller of chatGptControllers) controller.abort();
    window.postMessage({ source: SOURCE, direction: "main-to-content", kind: "chatgptContextChanged", platform: "chatgpt" }, window.location.origin);
  });
  const GEMINI_USAGE_RPC_ID = "jSf9Qc";
  const geminiBatchExecuteState = {};
  if (!window.__AI_USAGE_FLOATING_MONITOR_BRIDGE__) {
    window.__AI_USAGE_FLOATING_MONITOR_BRIDGE__ = true;
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
      "grok:credits-config": {
        platform: "grok",
        method: "POST",
        url: "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig",
        headers: {
          accept: "application/grpc-web+proto",
          "content-type": "application/grpc-web+proto",
          "x-grpc-web": "1"
        },
        body: "\0\0\0\0\0",
        responseType: "base64"
      },
      "claude:organizations": {
        platform: "claude",
        method: "GET",
        url: "https://claude.ai/api/organizations"
      },
      "chatgpt:libraryStorage": {
        platform: "chatgpt",
        method: "GET",
        url: "https://chatgpt.com/backend-api/files/library/storage/usage"
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
      "chatgpt:accountsCheck": {
        platform: "chatgpt",
        method: "GET",
        url: `https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=${(/* @__PURE__ */ new Date()).getTimezoneOffset()}`
      },
      "kimi:subscription": {
        platform: "kimi",
        method: "POST",
        url: "https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscription",
        body: {}
      },
      "perplexity:rateLimitAll": {
        platform: "perplexity",
        method: "GET",
        url: "https://www.perplexity.ai/rest/rate-limit/all"
      }
    };
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
    let scopeKey;
    const controller = new AbortController();
    if (endpoint.platform === "chatgpt") chatGptControllers.add(controller);
    const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const headers = endpointHeaders(endpoint) ?? {};
      if (endpoint.platform === "chatgpt") {
        const session = await chatGptSession.read();
        headers.Authorization = `Bearer ${session.token}`;
        if (session.account) headers["ChatGPT-Account-ID"] = session.account;
        scopeKey = session.scopeKey;
      }
      const response = await ownedFetch(endpoint.url, {
        method: endpoint.method,
        credentials: "include",
        cache: "no-store",
        headers,
        body: endpointBody(endpoint),
        signal: controller.signal
      });
      if (!response.ok) {
        if (endpoint.platform === "chatgpt" && response.status === 401) chatGptSession.invalidate();
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
      if (endpoint.responseType === "base64") {
        return {
          source: SOURCE,
          direction: "main-to-content",
          requestId,
          ok: true,
          platform: endpoint.platform,
          endpointKey,
          text: arrayBufferToBase64(await response.arrayBuffer())
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
        const rawUrl = requestUrl(input);
        if (rawUrl.startsWith("https://chatgpt.com/backend-api/") || rawUrl.startsWith("/backend-api/")) {
          chatGptSession.observeAccount(requestHeaderValue(input, init, "ChatGPT-Account-ID"));
        }
        chatGptSession.scope();
        const usageRequest = getUsageRequest(input);
        const response = await originalFetch(input, init);
        if (rawUrl === "https://chatgpt.com/api/auth/session" || rawUrl === "/api/auth/session") {
          void response.clone().json().then((json) => chatGptSession.observeSession(json)).catch(() => void 0);
        }
        if (usageRequest?.platform === "chatgpt") {
          if (response.ok) {
            void response.clone().json().then((json) => postInterceptedUsage({ ...usageRequest, json })).catch(() => void 0);
          }
          return response;
        }
        try {
          if (usageRequest) {
            if (usageRequest.responseType === "base64") {
              const buffer = await response.arrayBuffer();
              const newResponse2 = new Response(buffer.slice(0), {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers
              });
              postInterceptedUsage({
                platform: usageRequest.platform,
                endpointKey: usageRequest.endpointKey,
                url: usageRequest.url,
                text: arrayBufferToBase64(buffer)
              });
              return newResponse2;
            }
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
            postInterceptedUsage({
              platform: usageRequest.platform,
              endpointKey: usageRequest.endpointKey,
              url: usageRequest.url,
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
      responseType: info.responseType
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
    if (url.origin === "https://grok.com" && url.pathname === "/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig") {
      return {
        platform: "grok",
        endpointKey: "grok:credits-config",
        responseType: "base64"
      };
    }
    if (url.origin === "https://claude.ai" && /^\/api\/organizations\/[^/]+\/usage$/.test(url.pathname)) {
      return { platform: "claude", endpointKey: "claude:usage" };
    }
    if (url.origin === "https://chatgpt.com") {
      if (url.pathname === "/backend-api/files/library/storage/usage") {
        return { platform: "chatgpt", endpointKey: "chatgpt:libraryStorage" };
      }
      if (url.pathname === "/backend-api/conversation/init") {
        return { platform: "chatgpt", endpointKey: "chatgpt:conversationInit" };
      }
      if (url.pathname === "/backend-api/wham/usage") {
        return { platform: "chatgpt", endpointKey: "chatgpt:whamUsage" };
      }
      if (url.pathname === "/backend-api/codex/usage") {
        return { platform: "chatgpt", endpointKey: "chatgpt:codexUsage" };
      }
      if (url.pathname === "/backend-api/wham/tasks/rate_limit") {
        return {
          platform: "chatgpt",
          endpointKey: "chatgpt:whamTasksRateLimit"
        };
      }
      if (/^\/backend-api\/accounts\/check\//.test(url.pathname)) {
        return {
          platform: "chatgpt",
          endpointKey: "chatgpt:accountsCheck"
        };
      }
    }
    if (url.origin === "https://www.kimi.com" && url.pathname === "/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscription") {
      return { platform: "kimi", endpointKey: "kimi:subscription" };
    }
    if (url.origin === "https://www.perplexity.ai" && url.pathname === "/rest/rate-limit/all") {
      return { platform: "perplexity", endpointKey: "perplexity:rateLimitAll" };
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
  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 32768;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }
  function postResponse(response) {
    window.postMessage(response, window.location.origin);
  }
})();
