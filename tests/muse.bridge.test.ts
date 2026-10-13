// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { findMuseSubscriptionAction, MuseSubscriptionBridge } from "../src/injected/museSubscription";
import { MUSE_ACTION_ID, MUSE_SCRIPT, museRsc } from "./museFixture";

function script(url = "https://muse.ai/_next/static/chunks/subscription.js"): void {
  const element = document.createElement("script"); element.type = "application/json"; element.src = url; document.head.append(element);
}
afterEach(() => { document.head.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Muse subscription action bridge", () => {
  it("recognizes the named subscription reference rather than other server actions", () => {
    expect(findMuseSubscriptionAction(MUSE_SCRIPT)).toBe(MUSE_ACTION_ID);
    expect(findMuseSubscriptionAction(MUSE_SCRIPT.replace("fetchSubscriptionAction", "purchaseSubscriptionAction"))).toBeNull();
    expect(findMuseSubscriptionAction(`createServerReference("${MUSE_ACTION_ID}",a,b,c,"fetchSubscriptionAction")`)).toBe(MUSE_ACTION_ID);
  });

  it("discovers the action, uses the minimal request, and caches the ID", async () => {
    script();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/_next/")) {
        expect(init?.cache).toBe("force-cache"); return new Response(MUSE_SCRIPT);
      }
      expect(init).toMatchObject({ method: "POST", credentials: "include", body: '[{"includeAgreement":false}]', headers: { "Next-Action": MUSE_ACTION_ID, Accept: "text/x-component" } });
      return new Response(museRsc());
    });
    const bridge = new MuseSubscriptionBridge(fetcher, document, "https://muse.ai");
    expect(await bridge.fetchUsage("1")).toMatchObject({ ok: true, endpointKey: "muse:subscription" });
    await bridge.fetchUsage("2");
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/_next/"))).toHaveLength(1);
    expect(bridge.matches(new URL("https://muse.ai/"), "POST", MUSE_ACTION_ID)).toBe(true);
    expect(bridge.matches(new URL("https://muse.ai/"), "POST", "other-action")).toBe(false);
    expect(bridge.matches(new URL("https://muse.ai/"), "GET", MUSE_ACTION_ID)).toBe(false);
    expect(bridge.matches(new URL("https://auth.muse.ai/"), "POST", MUSE_ACTION_ID)).toBe(false);
  });

  it("scans at most four scripts concurrently and stops after finding a reference", async () => {
    for (let index = 0; index < 12; index++) script(`https://muse.ai/_next/static/chunks/${index}.js`);
    let inFlight = 0, maximum = 0;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (!String(url).includes("/_next/")) return new Response(museRsc());
      inFlight++; maximum = Math.max(maximum, inFlight);
      await Promise.resolve(); inFlight--;
      return new Response(String(url).endsWith("/11.js") ? MUSE_SCRIPT : "unrelated");
    });
    await new MuseSubscriptionBridge(fetcher, document, "https://muse.ai").fetchUsage("1");
    expect(maximum).toBe(4);
    const scanned = fetcher.mock.calls.filter(([url]) => String(url).includes("/_next/"));
    expect(String(scanned[0][0])).toContain("/11.js");
    expect(scanned.length).toBeLessThan(12);
  });

  it.each([7, 3])("does not let a stalled unrelated script block action %s", async (reference) => {
    vi.useFakeTimers();
    for (let index = 0; index < 8; index++) script(`https://muse.ai/_next/static/chunks/${index}.js`);
    let canceled = false;
    const slow = reference === 7 ? 6 : 7;
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (!String(url).includes("/_next/")) {
        expect(init?.signal?.aborted).toBe(false);
        return new Response(museRsc());
      }
      if (String(url).endsWith(`/${slow}.js`)) return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => { canceled = true; reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      });
      return new Response(String(url).endsWith(`/${reference}.js`) ? MUSE_SCRIPT : "unrelated");
    });
    const pending = new MuseSubscriptionBridge(fetcher, document, "https://muse.ai").fetchUsage("1");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({ ok: true });
    expect(canceled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for chunks added after document_start and ignores other origins", async () => {
    script("https://example.com/_next/static/chunks/foreign.js");
    const fetcher = vi.fn(async (url: RequestInfo | URL) => new Response(String(url).includes("/_next/") ? MUSE_SCRIPT : museRsc()));
    const pending = new MuseSubscriptionBridge(fetcher, document, "https://muse.ai").fetchUsage("1");
    await Promise.resolve(); script();
    expect(await pending).toMatchObject({ ok: true });
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("example.com"))).toBe(false);
  });

  it("shares discovery and the request across concurrent refreshes", async () => {
    for (let index = 0; index < 8; index++) script(`https://muse.ai/_next/static/chunks/${index}.js`);
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      await Promise.resolve();
      return new Response(String(url).includes("/_next/") ? MUSE_SCRIPT : museRsc());
    });
    const bridge = new MuseSubscriptionBridge(fetcher, document, "https://muse.ai");
    const results = await Promise.all([bridge.fetchUsage("first"), bridge.fetchUsage("second")]);
    expect(results.map((result) => result.requestId)).toEqual(["first", "second"]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/_next/"))).toHaveLength(4);
    expect(fetcher.mock.calls.filter(([url]) => String(url) === "https://muse.ai/")).toHaveLength(1);
  });

  it("rediscovers a changed reference once after the server rejects the old action", async () => {
    script();
    const newId = "40" + "a".repeat(40);
    let deploymentChanged = false;
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes("/_next/")) return new Response(deploymentChanged ? MUSE_SCRIPT.replace(MUSE_ACTION_ID, newId) : MUSE_SCRIPT);
      const id = (init?.headers as Record<string, string>)["Next-Action"];
      if (id === MUSE_ACTION_ID) { deploymentChanged = true; return new Response("Server Action not found", { status: 404 }); }
      return new Response(museRsc());
    });
    const bridge = new MuseSubscriptionBridge(fetcher, document, "https://muse.ai");
    expect(await bridge.fetchUsage("1")).toMatchObject({ ok: true });
    expect(bridge.matches(new URL("https://muse.ai/"), "POST", newId)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("shares one ten-second deadline across discovery and request", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn();
    const pending = new MuseSubscriptionBridge(fetcher, document, "https://muse.ai").fetchUsage("1");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({ ok: false, error: { code: "NETWORK_ERROR", message: "识别 Muse 额度接口超时，请刷新页面后重试" } });
    expect(fetcher).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the same deadline after discovery and identifies a slow quota request", async () => {
    vi.useFakeTimers(); script();
    let postStartedAt = 0;
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes("/_next/")) {
        await new Promise((resolve) => window.setTimeout(resolve, 6_000));
        return new Response(MUSE_SCRIPT);
      }
      postStartedAt = Date.now();
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    });
    const startedAt = Date.now();
    const pending = new MuseSubscriptionBridge(fetcher, document, "https://muse.ai").fetchUsage("1");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(postStartedAt - startedAt).toBe(6_000);
    expect(await pending).toMatchObject({ ok: false, error: { message: "Muse 额度请求超时，请稍后刷新" } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    [401, "", 401],
    [200, museRsc({ success: false, sessionRecovery: { scope: "hatch", reason: "authentication" } }), 401],
    [200, "malformed", undefined]
  ])("reports HTTP %s and malformed/action authentication responses", async (status, body, errorStatus) => {
    script();
    const bridge = new MuseSubscriptionBridge(vi.fn(async (url) => new Response(String(url).includes("/_next/") ? MUSE_SCRIPT : body, { status: String(url).includes("/_next/") ? 200 : status })), document, "https://muse.ai");
    const result = await bridge.fetchUsage("1");
    expect(result.ok).toBe(false);
    expect(result.error?.status).toBe(errorStatus);
  });
});
