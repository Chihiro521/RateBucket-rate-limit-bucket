import {
  CHATGPT_SENTINEL_EVENT,
  chatRequirementsUrlKind,
  sanitizeSentinelResponse
} from "../platforms/chatgptSentinel";

declare global {
  interface Window {
    __AI_USAGE_FLOATING_MONITOR_SENTINEL_PATCHED__?: boolean;
  }
}

export function installChatGptSentinelHook(): void {
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

function installFetchHook(): void {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = requestUrl(input);
    const shouldObserve = rawUrl ? chatRequirementsUrlKind(rawUrl) !== null : false;
    const response = await originalFetch(input, init);
    if (shouldObserve && rawUrl) {
      observeFetchResponse(rawUrl, response);
    }
    return response;
  };
}

function observeFetchResponse(rawUrl: string, response: Response): void {
  response
    .clone()
    .json()
    .then((json: unknown) => {
      dispatchSanitizedObservation(rawUrl, json);
    })
    .catch(() => undefined);
}

function installXhrHook(): void {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const callOriginalOpen = originalOpen as unknown as (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ) => void;
  const observedUrls = new WeakMap<XMLHttpRequest, string>();

  function patchedOpen(this: XMLHttpRequest, method: string, url: string | URL): void;
  function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async: boolean,
    username?: string | null,
    password?: string | null
  ): void;
  function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ): void {
    const rawUrl = xhrOpenUrl(url);
    if (rawUrl && chatRequirementsUrlKind(rawUrl)) {
      observedUrls.set(this, rawUrl);
    } else {
      observedUrls.delete(this);
    }
    if (async === undefined) {
      return callOriginalOpen.call(this, method, url);
    }
    return callOriginalOpen.call(this, method, url, async, username, password);
  }

  XMLHttpRequest.prototype.open = patchedOpen;

  XMLHttpRequest.prototype.send = function (
    ...args: Parameters<typeof originalSend>
  ): void {
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

function observeXhrResponse(rawUrl: string, xhr: XMLHttpRequest): void {
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
    // Never break the host page.
  }
}

function dispatchSanitizedObservation(rawUrl: string, json: unknown): void {
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

function requestUrl(input: RequestInfo | URL): string | null {
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

function xhrOpenUrl(url: string | URL): string | null {
  if (typeof url === "string") {
    return url;
  }
  if (url instanceof URL) {
    return url.href;
  }
  return null;
}

function isChatGptHost(hostname: string): boolean {
  return hostname === "chatgpt.com" || hostname.endsWith(".chatgpt.com");
}
