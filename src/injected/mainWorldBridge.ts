import type {
  BridgeResponse,
  EndpointKey,
  PlatformId
} from "../platforms/types";
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
  const grokBody = (modelName: string): unknown => ({
    requestKind: "DEFAULT",
    modelName
  });

  const endpoints: Partial<Record<EndpointKey, EndpointDefinition>> = {
    "grok:grok-3": {
      platform: "grok",
      method: "POST",
      url: "https://grok.com/rest/rate-limits",
      body: grokBody("grok-3")
    },
    "grok:grok-4-heavy": {
      platform: "grok",
      method: "POST",
      url: "https://grok.com/rest/rate-limits",
      body: grokBody("grok-4-heavy")
    },
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

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init);
    try {
      const url = requestUrl(input);
      const info = usageUrlInfo(url);
      if (info) {
        response
          .clone()
          .json()
          .then((json: unknown) => {
            window.postMessage(
              {
                source: SOURCE,
                direction: "main-to-content",
                kind: "interceptedUsage",
                platform: info.platform,
                endpointKey: info.endpointKey,
                url: sanitizeUrl(url),
                json,
                ts: Date.now()
              },
              window.location.origin
            );
            if (window.parent && window.parent !== window) {
              window.parent.postMessage(
                {
                  source: SOURCE,
                  direction: "main-to-content",
                  kind: "interceptedUsage",
                  platform: info.platform,
                  endpointKey: info.endpointKey,
                  url: sanitizeUrl(url),
                  json,
                  ts: Date.now()
                },
                window.location.origin
              );
            }
          })
          .catch(() => undefined);
      }
    } catch {
      // Never break the host page.
    }
    return response;
  };
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
    return { platform: "grok" };
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
