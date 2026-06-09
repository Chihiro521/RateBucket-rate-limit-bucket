import type {
  BridgeResponse,
  EndpointKey,
  PlatformId,
  UsageRequestContext
} from "../platforms/types";
import { installChatGptSentinelHook } from "./chatgptSentinelHook";
import { SOURCE, isBridgeRequest } from "../utils/protocol";
import { asRecord, getString } from "../utils/safeJson";

declare global {
  interface Window {
    __AI_USAGE_FLOATING_MONITOR_BRIDGE__?: boolean;
    __AI_USAGE_FLOATING_MONITOR_FETCH_PATCHED__?: boolean;
    WIZ_global_data?: unknown;
  }
}

type EndpointDefinition = {
  platform: PlatformId;
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  responseType?: "json" | "text";
};

type UsageRequestInfo = {
  platform: PlatformId;
  endpointKey?: EndpointKey;
  url: string;
  responseType?: "json" | "text";
  usageContext?: UsageRequestContext | Promise<UsageRequestContext | undefined>;
};

type GeminiReplayParams = {
  at: string;
  bl: string;
  fSid: string;
  reqid: string;
  rt: string;
  hl: string;
  authuser: string;
};

type GeminiBatchExecuteState = Partial<GeminiReplayParams>;

type GeminiWizGlobalData = {
  at?: string;
  bl?: string;
  fSid?: string;
};

const FETCH_TIMEOUT_MS = 10_000;
const GEMINI_USAGE_RPC_ID = "jSf9Qc";
const geminiBatchExecuteState: GeminiBatchExecuteState = {};

if (!window.__AI_USAGE_FLOATING_MONITOR_BRIDGE__) {
  window.__AI_USAGE_FLOATING_MONITOR_BRIDGE__ = true;
  installChatGptSentinelHook();
  installFetchIntercept();
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== window.location.origin) {
      return;
    }
    if (!isBridgeRequest(event.data)) {
      return;
    }
    void handleRequest(event.data);
  });
}

async function handleRequest(request: {
  requestId: string;
  action: "fetchUsage" | "enableIntercept";
  platform: PlatformId;
  endpointKey?: EndpointKey;
  payload?: unknown;
}): Promise<void> {
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
        message:
          request.endpointKey === "gemini:usageBatchExecute"
            ? "Missing Gemini usage replay parameters"
            : "Endpoint is not allowed"
      }
    });
    return;
  }

  const response = await fetchEndpoint(endpoint, request.requestId, request.endpointKey);
  postResponse(response);
}

function resolveEndpoint(
  platform: PlatformId,
  endpointKey: EndpointKey,
  payload: unknown
): EndpointDefinition | null {
  const endpoints: Partial<Record<EndpointKey, EndpointDefinition>> = {
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
    },
    "perplexity:rateLimitAll": {
      platform: "perplexity",
      method: "GET",
      url: "https://www.perplexity.ai/rest/rate-limit/all"
    }
  };

  if (endpointKey === "grok:rate-limits") {
    if (platform !== "grok") {
      return null;
    }
    const payloadRecord = asRecord(payload);
    const modelName = payloadRecord ? getString(payloadRecord, "modelName") : null;
    const requestKind =
      (payloadRecord ? getString(payloadRecord, "requestKind") : null) ?? "DEFAULT";
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

function resolveGeminiUsageEndpoint(): EndpointDefinition | null {
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

function currentGeminiReplayParams(): GeminiReplayParams | null {
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

function readGeminiWizGlobalData(): GeminiWizGlobalData {
  const data = asRecord(window.WIZ_global_data);
  if (!data) {
    return {};
  }
  return {
    at: getString(data, "SNlM0e") ?? undefined,
    fSid: getString(data, "FdrFJe") ?? undefined,
    bl: getString(data, "cfb2h") ?? undefined
  };
}

function nextGeminiReqid(value: string | undefined): string {
  const parsed = value ? Number(value) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return String(Math.floor(parsed) + 100_000);
  }
  return String(100_000 + Math.floor(Date.now() % 90_000));
}

function endpointHeaders(endpoint: EndpointDefinition): Record<string, string> | undefined {
  if (endpoint.headers) {
    return endpoint.headers;
  }
  if (endpoint.body === undefined) {
    return undefined;
  }
  return {
    "Content-Type": "application/json"
  };
}

function endpointBody(endpoint: EndpointDefinition): BodyInit | undefined {
  if (endpoint.body === undefined) {
    return undefined;
  }
  if (typeof endpoint.body === "string") {
    return endpoint.body;
  }
  return JSON.stringify(endpoint.body);
}

async function fetchEndpoint(
  endpoint: EndpointDefinition,
  requestId: string,
  endpointKey: EndpointKey
): Promise<BridgeResponse> {
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

    let json: unknown;
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

function installFetchIntercept(): void {
  if (window.__AI_USAGE_FLOATING_MONITOR_FETCH_PATCHED__) {
    return;
  }
  window.__AI_USAGE_FLOATING_MONITOR_FETCH_PATCHED__ = true;
  const originalFetch = window.fetch.bind(window);

  function makePatchedFetch(): typeof window.fetch {
    return async (input: RequestInfo | URL, init?: RequestInit) => {
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
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            // Ignore parse errors.
          }
          const usageContext = await usageRequest.usageContext;
          postInterceptedUsage({
            platform: usageRequest.platform,
            endpointKey: usageRequest.endpointKey,
            url: usageRequest.url,
            usageContext,
            json,
            text: usageRequest.responseType === "text" ? text : undefined
          });
          return newResponse;
        }
      } catch {
        // Never break the host page.
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
  }, 2_000);
}

function isSafeGrokModelName(value: string | null): value is string {
  return value !== null && /^[A-Za-z0-9._:-]{1,120}$/.test(value);
}

function isSafeGrokRequestKind(value: string | null): value is string {
  return value !== null && /^[A-Z_]{1,40}$/.test(value);
}

function rememberGeminiBatchExecuteRequest(
  input: RequestInfo | URL,
  init?: RequestInit
): void {
  let rawUrl: string;
  try {
    rawUrl = requestUrl(input);
  } catch {
    return;
  }

  let url: URL;
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

function rememberGeminiBatchExecuteMetadata(
  url: URL,
  authuser: string,
  bodyText?: string
): void {
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
      // Ignore malformed form bodies.
    }
  }
}

function setGeminiStateValue(
  key: keyof GeminiBatchExecuteState,
  value: string | null
): void {
  if (value) {
    geminiBatchExecuteState[key] = value;
  }
}

function requestBodyText(
  input: RequestInfo | URL,
  init?: RequestInit
): string | Promise<string | undefined> | undefined {
  if (init?.body !== undefined) {
    return bodyTextFromBody(init.body);
  }
  if (input instanceof Request && !input.bodyUsed) {
    return input
      .clone()
      .text()
      .then((text) => text || undefined)
      .catch(() => undefined);
  }
  return undefined;
}

function bodyTextFromBody(body: BodyInit | null): string | Promise<string | undefined> | undefined {
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
    return body
      .text()
      .then((text) => text || undefined)
      .catch(() => undefined);
  }
  return undefined;
}

function requestHeaderValue(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  name: string
): string | null {
  return (
    headerValue(init?.headers, name) ??
    (input instanceof Request ? input.headers.get(name) : null)
  );
}

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
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

function currentGeminiAuthUser(): string {
  return resolveGeminiAuthUser();
}

function resolveGeminiAuthUser(url?: URL, headerAuthuser?: string | null): string {
  return (
    sanitizeGeminiAuthUser(headerAuthuser) ??
    sanitizeGeminiAuthUser(url?.searchParams.get("authuser")) ??
    sanitizeGeminiAuthUser(currentPageUrl().searchParams.get("authuser")) ??
    authUserFromPath(window.location.pathname) ??
    "0"
  );
}

function currentPageUrl(): URL {
  try {
    return new URL(window.location.href);
  } catch {
    return new URL("https://gemini.google.com/");
  }
}

function sanitizeGeminiAuthUser(value: string | null | undefined): string | null {
  return value && /^\d{1,3}$/.test(value) ? value : null;
}

function authUserFromPath(pathname: string): string | null {
  const match = /^\/u\/(\d{1,3})(?:\/|$)/.exec(pathname);
  return match?.[1] ?? null;
}

function pageLanguage(): string {
  const language = document.documentElement.lang || navigator.language || "zh-CN";
  return /^[A-Za-z0-9_-]{2,20}$/.test(language) ? language : "zh-CN";
}

function getUsageRequest(
  input: RequestInfo | URL,
  init?: RequestInit
): UsageRequestInfo | null {
  let rawUrl: string;
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
    usageContext:
      info.platform === "grok" ? grokRequestContext(input, init) : undefined
  };
}

function grokRequestContext(
  input: RequestInfo | URL,
  init?: RequestInit
): UsageRequestContext | Promise<UsageRequestContext | undefined> | undefined {
  if (init?.body !== undefined) {
    return usageContextFromBody(init.body);
  }
  if (input instanceof Request && !input.bodyUsed) {
    return input
      .clone()
      .text()
      .then(usageContextFromText)
      .catch(() => undefined);
  }
  return undefined;
}

function usageContextFromBody(
  body: BodyInit | null
): UsageRequestContext | Promise<UsageRequestContext | undefined> | undefined {
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
    return body
      .text()
      .then(usageContextFromText)
      .catch(() => undefined);
  }
  return undefined;
}

function usageContextFromText(text: string): UsageRequestContext | undefined {
  if (!text.trim()) {
    return undefined;
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
      return undefined;
    }
  }
}

function usageContextFromRecord(value: unknown): UsageRequestContext | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const modelName =
    getString(record, "modelName") ??
    getString(record, "model") ??
    getString(record, "modelId");
  const requestKind =
    getString(record, "requestKind") ??
    getString(record, "kind") ??
    getString(record, "mode");
  if (!modelName && !requestKind) {
    return undefined;
  }
  return {
    modelName: modelName ?? undefined,
    requestKind: requestKind ?? undefined
  };
}

function postInterceptedUsage(args: {
  platform: PlatformId;
  endpointKey?: EndpointKey;
  url: string;
  usageContext?: UsageRequestContext;
  json: unknown;
  text?: string;
}): void {
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
  } as const;

  window.postMessage(message, window.location.origin);
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(message, window.location.origin);
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function usageUrlInfo(
  rawUrl: string
): {
  platform: PlatformId;
  endpointKey?: EndpointKey;
  responseType?: "json" | "text";
} | null {
  let url: URL;
  try {
    url = new URL(rawUrl, window.location.origin);
  } catch {
    return null;
  }

  if (url.origin === "https://grok.com" && url.pathname === "/rest/rate-limits") {
    return { platform: "grok", endpointKey: "grok:rate-limits" };
  }
  if (
    url.origin === "https://claude.ai" &&
    /^\/api\/organizations\/[^/]+\/usage$/.test(url.pathname)
  ) {
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
  if (
    url.origin === "https://www.kimi.com" &&
    url.pathname === "/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscription"
  ) {
    return { platform: "kimi", endpointKey: "kimi:subscription" };
  }
  if (
    url.origin === "https://www.perplexity.ai" &&
    url.pathname === "/rest/rate-limit/all"
  ) {
    return { platform: "perplexity", endpointKey: "perplexity:rateLimitAll" };
  }
  if (
    isGeminiBatchExecuteUrl(url) &&
    hasGeminiUsageRpcId(url.searchParams.get("rpcids"))
  ) {
    return {
      platform: "gemini",
      endpointKey: "gemini:usageBatchExecute",
      responseType: "text"
    };
  }
  return null;
}

function isGeminiBatchExecuteUrl(url: URL): boolean {
  return (
    url.origin === "https://gemini.google.com" &&
    /^\/(?:u\/\d{1,3}\/)?_\/BardChatUi\/data\/batchexecute$/.test(url.pathname)
  );
}

function hasGeminiUsageRpcId(value: string | null): boolean {
  return value?.split(",").includes(GEMINI_USAGE_RPC_ID) ?? false;
}

function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, window.location.origin);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

function postResponse(response: BridgeResponse): void {
  window.postMessage(response, window.location.origin);
}
