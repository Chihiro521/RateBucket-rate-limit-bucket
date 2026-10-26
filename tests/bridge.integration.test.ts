// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MUSE_ACTION_ID, MUSE_SCRIPT, museRsc } from "./museFixture";

const source = "ai-usage-floating-monitor";
const nativeFetch = window.fetch;
let messageListeners: EventListenerOrEventListenerObject[];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
async function installChatGptBridge(fetcher: typeof fetch) {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("https://chatgpt.com/");
  window.fetch = fetcher;
  const posted = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
  await import("../src/injected/mainWorldBridge");
  return posted;
}
beforeEach(() => {
  messageListeners = [];
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
    if (type === "message") messageListeners.push(listener);
    add(type, listener, options);
  });
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  delete window.__AI_USAGE_FLOATING_MONITOR_BRIDGE__;
  delete window.__AI_USAGE_FLOATING_MONITOR_FETCH_PATCHED__;
});
afterEach(() => {
  for (const listener of messageListeners) window.removeEventListener("message", listener);
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); window.fetch = nativeFetch;
  document.head.replaceChildren();
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("http://localhost:3000/");
});

describe("main-world bridge integration", () => {
  it.each([["image", "headers"], ["image", "body"], ["quota", "body"]])("discards an old %s response when the account changes before its %s arrive", async (kind, phase) => {
    const image = kind === "image", url = image ? "/backend-api/f/conversation" : "/backend-api/wham/usage";
    const body = image ? `data: ${JSON.stringify({ message: { author: { role: "assistant" }, channel: "final", status: "finished_successfully", content: { content_type: "text", parts: ["已达到每日图像生成上限，请等待 19 小时后再试。"] } } })}\n\ndata: [DONE]\n\n`
      : '{"rate_limit":{"primary_window":{"used_percent":100}}}';
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const original = new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }), { headers: { "Content-Type": image ? "text/event-stream" : "application/json" } });
    const late = deferred<Response>(), clone = vi.spyOn(original, "clone");
    const posted = await installChatGptBridge(vi.fn(async (input) => String(input) === url
      ? phase === "headers" ? late.promise : original : new Response("{}")));
    const request = window.fetch(url, { method: image ? "POST" : "GET", headers: { "ChatGPT-Account-ID": "synthetic-account-a" } });
    if (phase === "body") await request;
    await window.fetch("/backend-api/sentinel/chat-requirements", { headers: { "ChatGPT-Account-ID": "synthetic-account-b" } });
    if (phase === "headers") { late.resolve(original); await request; expect(clone).not.toHaveBeenCalled(); }
    stream.enqueue(new TextEncoder().encode(body));
    stream.close();
    expect(await (await request).text()).toBe(body);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posted.mock.calls.filter(([data]) => data.kind === "interceptedUsage")).toHaveLength(0);
    expect(posted.mock.calls.filter(([data]) => data.kind === "chatgptContextChanged")).toHaveLength(2);
  });
  it("returns an account-specific scope and request timestamps from owned ChatGPT queries", async () => {
    let user = "synthetic-user-a";
    const posted = await installChatGptBridge(vi.fn(async (url) => new Response(JSON.stringify(String(url).endsWith("/api/auth/session")
      ? { accessToken: "synthetic-token", user: { id: user } } : { valid: true }))));
    for (const account of ["a", "b"]) {
      user = `synthetic-user-${account}`;
      if (account === "b") {
        await window.fetch("/api/auth/session");
        await vi.waitFor(() => expect(posted.mock.calls.filter(([data]) => data.kind === "chatgptContextChanged")).toHaveLength(2));
      }
      await window.fetch("/backend-api/sentinel/chat-requirements", { headers: { "ChatGPT-Account-ID": `synthetic-account-${account}` } });
      window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, source: window,
        data: { source, direction: "content-to-main", requestId: account, platform: "chatgpt", action: "fetchUsage", endpointKey: "chatgpt:conversationInit" } }));
      await vi.waitFor(() => expect(posted.mock.calls.some(([data]) => data.requestId === account && data.ok)).toBe(true));
    }
    const results = posted.mock.calls.map(([data]) => data).filter((data) => data.ok);
    expect(results).toHaveLength(2);
    expect(results[0].scopeKey).toMatch(/^[a-f0-9]{64}$/);
    expect(results[0].scopeKey).not.toBe(results[1].scopeKey);
    expect(results[0].observedAt).toBeGreaterThanOrEqual(results[0].requestStartedAt);
    expect(JSON.stringify(posted.mock.calls)).not.toContain("synthetic-token");
    expect(JSON.stringify(posted.mock.calls)).not.toContain("synthetic-user");
    expect(JSON.stringify(posted.mock.calls)).not.toContain("synthetic-account");
  });
  it("rejects an old owned quota result even when its transport ignores cancellation", async () => {
    const late = deferred<Response>();
    const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).endsWith("/api/auth/session")
      ? new Response(JSON.stringify({ accessToken: "synthetic-token", user: { id: "synthetic-user" } }))
      : String(url).endsWith("/wham/usage") ? late.promise : new Response("{}"));
    const posted = await installChatGptBridge(fetcher);
    await window.fetch("/backend-api/sentinel/chat-requirements", { headers: { "ChatGPT-Account-ID": "synthetic-account-a" } });
    window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, source: window,
      data: { source, direction: "content-to-main", requestId: "old-owned", platform: "chatgpt", action: "fetchUsage", endpointKey: "chatgpt:whamUsage" } }));
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/wham/usage"))).toBe(true));
    await window.fetch("/backend-api/sentinel/chat-requirements", { headers: { "ChatGPT-Account-ID": "synthetic-account-b" } });
    late.resolve(new Response('{"rate_limit":{"primary_window":{"used_percent":100}}}'));
    await vi.waitFor(() => expect(posted.mock.calls.some(([data]) => data.requestId === "old-owned")).toBe(true));
    const result = posted.mock.calls.map(([data]) => data).find((data) => data.requestId === "old-owned");
    expect(result.ok).toBe(false); expect(result.json).toBeUndefined();
  });
  it("returns the original image stream immediately and emits only a derived assistant report", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const original = new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }), { headers: { "Content-Type": "text/event-stream" } });
    const posted = await installChatGptBridge(vi.fn(async () => original));
    const result = await window.fetch("/backend-api/f/conversation", { method: "POST" });
    expect(result).toBe(original); expect(original.bodyUsed).toBe(false);
    const body = `data: ${JSON.stringify({ message: { author: { role: "assistant" }, channel: "analysis", content: { content_type: "text", parts: ["synthetic-private-analysis"] } } })}\n\n` +
      `data: ${JSON.stringify({ message: { author: { role: "assistant" }, channel: "final", status: "finished_successfully", content: { content_type: "text", parts: ["已达到每日图像生成上限，请等待 19 小时 58 分钟后再试。synthetic-private-text"] } } })}\n\ndata: [DONE]\n\n`;
    const bytes = new TextEncoder().encode(body);
    for (let i = 0; i < bytes.length; i += 7) stream.enqueue(bytes.slice(i, i + 7));
    stream.close();
    await vi.waitFor(() => expect(posted.mock.calls.some(([data]) => data.endpointKey === "chatgpt:imageGeneration")).toBe(true));
    const notices = posted.mock.calls.map(([data]) => data).filter((data) => data.endpointKey === "chatgpt:imageGeneration");
    expect(notices).toHaveLength(1);
    expect(notices[0].json).toEqual({ kind: "daily_limit", evidence: "assistant", cooldownSeconds: 71_880 });
    expect(JSON.stringify(posted.mock.calls)).not.toContain("synthetic-private");
    expect(await original.text()).toBe(body);
  });
  it("ignores HTTP 429 instead of inventing an image daily cap or a short throttle notice", async () => {
    const posted = await installChatGptBridge(vi.fn(async () => new Response('{"error":{"code":"rate_limit_exceeded"}}', { status: 429, headers: { "Retry-After": "60" } })));
    await window.fetch("/backend-api/f/conversation", { method: "POST" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posted.mock.calls.some(([data]) => data.endpointKey === "chatgpt:imageGeneration")).toBe(false);
    await window.fetch("/backend-api/f/conversation", { method: "POST", body: JSON.stringify({ messages: [{ metadata: { system_hints: ["picture_v2"] } }] }) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posted.mock.calls.some(([data]) => data.endpointKey === "chatgpt:imageGeneration")).toBe(false);
  });
  it("leaves an oversized image response intact without forwarding a partial report", async () => {
    const body = `data: ${JSON.stringify({ message: { author: { role: "assistant" }, channel: "final", status: "finished_successfully",
      content: { content_type: "text", parts: ["已达到每日图像生成上限"] } } })}\n\n` + "x".repeat(2 * 1024 * 1024);
    const response = new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    const posted = await installChatGptBridge(vi.fn(async () => response));
    expect(await (await window.fetch("/backend-api/f/conversation", { method: "POST" })).text()).toBe(body);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posted.mock.calls.some(([data]) => data.endpointKey === "chatgpt:imageGeneration")).toBe(false);
  });
  it("recognizes a live asynchronous image result but ignores unrelated and old conversation messages", async () => {
    const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", now = Date.now();
    const unrelated = new Response("private unrelated conversation"), clone = vi.spyOn(unrelated, "clone");
    const posted = await installChatGptBridge(vi.fn(async (url) => {
      if (String(url).endsWith("/f/conversation")) return new Response(`data: ${JSON.stringify({ conversation_id: id })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
      if (!String(url).endsWith(id)) return unrelated;
      return new Response(JSON.stringify({ messages: [
        { author: { role: "assistant" }, channel: "final", status: "finished_successfully", create_time: now / 1000 - 100,
          content: { content_type: "text", parts: ["已达到每日图像生成上限"] } },
        { author: { role: "tool" }, status: "finished_successfully", create_time: now / 1000,
          content: { content_type: "multimodal_text", parts: [{ content_type: "image_asset_pointer", asset_pointer: "private-image" }] } }
      ] }));
    }));
    await window.fetch("/backend-api/conversations/unrelated");
    expect(clone).not.toHaveBeenCalled();
    await (await window.fetch("/backend-api/f/conversation", { method: "POST" })).text();
    await window.fetch(`/backend-api/conversations/${id}`);
    await vi.waitFor(() => expect(posted.mock.calls.some(([data]) => data.endpointKey === "chatgpt:imageGeneration")).toBe(true));
    const notices = posted.mock.calls.filter(([data]) => data.endpointKey === "chatgpt:imageGeneration").map(([data]) => data.json);
    expect(notices).toEqual([{ kind: "success", evidence: "server" }]);
    expect(JSON.stringify(posted.mock.calls)).not.toContain("private-image");
    expect(JSON.stringify(posted.mock.calls)).not.toContain(id);
  });
  it("returns Muse's original stream immediately and observes only its identified usage action", async () => {
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("https://muse.ai/");
    const script = document.createElement("script"); script.type = "application/json"; script.src = "https://muse.ai/_next/static/chunks/usage.js"; document.head.append(script);
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const original = new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }));
    const unrelated = new Response("unrelated server action");
    window.fetch = vi.fn(async (url, init) => {
      if (String(url).includes("/_next/")) return new Response(MUSE_SCRIPT);
      if ((init?.headers as Record<string, string>)?.["Next-Action"] === "other-action") return unrelated;
      if (init?.body === "passive") return original;
      return new Response(museRsc());
    });
    const posted = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    await import("../src/injected/mainWorldBridge");
    window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, source: window,
      data: { source, direction: "content-to-main", requestId: "muse", platform: "muse", action: "fetchUsage", endpointKey: "muse:subscription" } }));
    await vi.waitFor(() => expect(posted.mock.calls.some(([data]) => data.requestId === "muse" && data.ok === true)).toBe(true));
    expect(await window.fetch("/", { method: "POST", headers: { "Next-Action": "other-action" } })).toBe(unrelated);
    expect(unrelated.bodyUsed).toBe(false);
    expect(await window.fetch("/", { method: "POST", headers: { "Next-Action": MUSE_ACTION_ID }, body: "passive" })).toBe(original);
    expect(original.bodyUsed).toBe(false);
    expect(posted.mock.calls.filter(([data]) => data.kind === "interceptedUsage")).toHaveLength(0);
    stream.enqueue(new TextEncoder().encode(museRsc())); stream.close();
    await vi.waitFor(() => expect(posted.mock.calls.filter(([data]) => data.kind === "interceptedUsage")).toHaveLength(1));
    expect(await original.text()).toBe(museRsc());
    expect(JSON.stringify(posted.mock.calls)).not.toContain("synthetic-billing-data");
  });
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
