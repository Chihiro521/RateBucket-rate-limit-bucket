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
  }
}

type EndpointDefinition = {
  platform: PlatformId;
  method: "GET" | "POST";
  url: string;
  body?: unknown;
};

const FETCH_TIMEOUT_MS = 10_000;

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
      error: { message: "Endpoint is not allowed" }
    });
    return;
  }

  const response = await fetchJson(endpoint, request.requestId, request.endpointKey);
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

  const endpoint = endpoints[endpointKey];
  if (!endpoint || endpoint.platform !== platform) {
    return null;
  }
  return endpoint;
}

async function fetchJson(
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
      headers:
        endpoint.body === undefined
          ? undefined
          : {
              "Content-Type": "application/json"
            },
      body: endpoint.body === undefined ? undefined : JSON.stringify(endpoint.body),
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
            json
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

function getUsageRequest(
  input: RequestInfo | URL,
  init?: RequestInit
): {
  platform: PlatformId;
  endpointKey?: EndpointKey;
  url: string;
  usageContext?: UsageRequestContext | Promise<UsageRequestContext | undefined>;
} | null {
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
): { platform: PlatformId; endpointKey?: EndpointKey } | null {
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
  return null;
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
