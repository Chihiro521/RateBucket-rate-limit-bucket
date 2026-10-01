// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = "ai-usage-floating-monitor";
const nativeFetch = window.fetch;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  delete window.__AI_USAGE_FLOATING_MONITOR_BRIDGE__;
  delete window.__AI_USAGE_FLOATING_MONITOR_FETCH_PATCHED__;
});
afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); window.fetch = nativeFetch;
});

describe("main-world bridge integration", () => {
  it("leaves the website's challenge response untouched and unobserved", async () => {
    const response = new Response('{"proofofwork":{"required":true,"difficulty":"061a80"}}');
    const clone = vi.spyOn(response, "clone");
    window.fetch = vi.fn(async () => response);
    const posted = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    await import("../src/injected/mainWorldBridge");
    expect(await window.fetch("https://chatgpt.com/backend-api/sentinel/chat-requirements")).toBe(response);
    expect(clone).not.toHaveBeenCalled();
    expect(posted).not.toHaveBeenCalled();
    expect(response.bodyUsed).toBe(false);
  });
  it("returns the original response before a passive quota body finishes", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }));
    window.fetch = vi.fn(async () => response);
    const posted = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    await import("../src/injected/mainWorldBridge");
    const result = await window.fetch("https://chatgpt.com/backend-api/wham/usage");
    expect(result).toBe(response); expect(result.bodyUsed).toBe(false);
    expect(posted.mock.calls.filter(([data]) => data.kind === "interceptedUsage")).toHaveLength(0);
    stream.enqueue(new TextEncoder().encode('{"rate_limit":{"primary_window":{"used_percent":1}}}')); stream.close();
    await vi.waitFor(() => expect(posted.mock.calls.filter(([data]) => data.kind === "interceptedUsage")).toHaveLength(1));
  });
  it("does not re-intercept owned queries and shares their auth lookup", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => new Response(JSON.stringify(String(url).endsWith("/api/auth/session") ? { accessToken: "synthetic-token" } : { valid: true })));
    window.fetch = fetcher;
    const posted = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    await import("../src/injected/mainWorldBridge");
    for (const endpointKey of ["chatgpt:conversationInit", "chatgpt:whamUsage", "chatgpt:libraryStorage"]) {
      window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, source: window,
        data: { source, direction: "content-to-main", requestId: endpointKey, platform: "chatgpt", action: "fetchUsage", endpointKey } }));
    }
    await vi.waitFor(() => expect(posted.mock.calls.filter(([data]) => data.direction === "main-to-content" && data.ok === true)).toHaveLength(3));
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/api/auth/session"))).toHaveLength(1);
    expect(posted.mock.calls.some(([data]) => data.kind === "interceptedUsage")).toBe(false);
    expect(JSON.stringify(posted.mock.calls)).not.toContain("synthetic-token");
  });
});
