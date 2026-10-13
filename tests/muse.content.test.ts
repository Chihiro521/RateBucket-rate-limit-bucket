// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeResponse, InterceptedUsageMessage, UsageSnapshot } from "../src/platforms/types";
import { MUSE_RESPONSE } from "./museFixture";

const state = vi.hoisted(() => ({
  fetcher: vi.fn(), snapshots: [] as UsageSnapshot[], intercept: undefined as ((message: InterceptedUsageMessage) => void) | undefined,
  refresh: undefined as (() => void) | undefined, storage: {} as Record<string, unknown>
}));
vi.mock("../src/content/bridgeClient", () => ({ BridgeClient: class {
  fetchUsage = state.fetcher;
  enableIntercept = async () => ({ ok: true });
  onIntercepted(handler: typeof state.intercept) { state.intercept = handler; }
  destroy() {}
} }));
vi.mock("../src/content/widget", () => ({ UsageWidget: class {
  constructor(_platform: string, refresh: () => void) { state.refresh = refresh; }
  mount() {}
  setLanguageMode() {}
  setBackoffUntil() {}
  setLoading() {}
  setSnapshot(snapshot: UsageSnapshot) { state.snapshots.push(snapshot); }
  destroy() {}
} }));

function response(): BridgeResponse {
  return { source: "ai-usage-floating-monitor", direction: "main-to-content", requestId: "1", platform: "muse", ok: true, json: MUSE_RESPONSE, requestStartedAt: Date.now(), observedAt: Date.now() };
}
async function settle(): Promise<void> { for (let index = 0; index < 30; index++) await Promise.resolve(); }

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-13T03:00:00Z"));
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("https://muse.ai/");
  delete window.__AI_USAGE_FLOATING_MONITOR_CONTENT__;
  state.snapshots = []; state.storage = {}; state.fetcher.mockReset(); state.fetcher.mockImplementation(async () => response());
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.stubGlobal("chrome", {
    runtime: { sendMessage: (_message: unknown, callback: (value: unknown) => void) => callback({ ok: true }) },
    storage: { local: {
      get: (keys: string | string[], callback: (value: unknown) => void) => callback(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, state.storage[key]]))),
      set: (items: Record<string, unknown>, callback: () => void) => { Object.assign(state.storage, items); callback(); },
      remove: (key: string, callback: () => void) => { delete state.storage[key]; callback(); }
    }, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } }
  });
});
afterEach(() => { window.dispatchEvent(new Event("pagehide")); delete window.__AI_USAGE_FLOATING_MONITOR_CONTENT__; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Muse page refresh lifecycle", () => {
  it("checks the current login before displaying old cache, then polls while visible", async () => {
    state.storage["aiUsage:muse:snapshot"] = { platform: "muse", meters: [{ key: "old-account" }], checkedAt: Date.now(), updatedAt: Date.now(), status: "ok" };
    state.storage["aiUsage:muse:lastRefreshAt"] = Date.now();
    await import("../src/content/content"); await settle();
    expect(state.fetcher).toHaveBeenCalledOnce();
    expect(state.snapshots.some((snapshot) => snapshot.meters.some((meter) => meter.key === "old-account"))).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000); await settle();
    expect(state.fetcher).toHaveBeenCalledTimes(2);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await vi.advanceTimersByTimeAsync(120_000); await settle();
    expect(state.fetcher).toHaveBeenCalledTimes(2);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange")); await settle();
    expect(state.fetcher).toHaveBeenCalledTimes(3);
    state.refresh?.(); await settle();
    expect(state.fetcher).toHaveBeenCalledTimes(4);
  });

  it("clears cached readings after authentication fails and respects retry backoff", async () => {
    await import("../src/content/content"); await settle();
    expect(state.storage["aiUsage:muse:snapshot"]).toBeDefined();
    state.fetcher.mockResolvedValue({ ...response(), ok: false, error: { status: 401, message: "Unauthorized" } });
    state.refresh?.(); await settle();
    expect(state.snapshots.at(-1)).toMatchObject({ errorCode: "UNAUTHORIZED", meters: [] });
    expect(state.snapshots.at(-1)?.checkedAt).toBeUndefined();
    expect(state.storage["aiUsage:muse:snapshot"]).toBeUndefined();
    state.refresh?.(); await settle();
    expect(state.fetcher).toHaveBeenCalledTimes(2);
  });

  it("coalesces rapid manual refreshes", async () => {
    await import("../src/content/content"); await settle();
    state.refresh?.(); state.refresh?.(); await settle();
    expect(state.fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps the successful query time and marks saved readings on a temporary failure", async () => {
    await import("../src/content/content"); await settle();
    const lastCheck = state.snapshots.at(-1)?.checkedAt;
    await vi.advanceTimersByTimeAsync(1000);
    state.fetcher.mockResolvedValue({ ...response(), ok: false, error: { status: 503, message: "Unavailable" } });
    state.refresh?.(); await settle();
    expect(state.snapshots.at(-1)).toMatchObject({ status: "partial", checkedAt: lastCheck, errorCode: "NETWORK_ERROR" });
    expect(state.snapshots.at(-1)?.meters).toHaveLength(2);
  });

  it("ignores an in-flight success after a passive authentication failure", async () => {
    await import("../src/content/content"); await settle();
    let complete!: (value: BridgeResponse) => void;
    state.fetcher.mockImplementation(() => new Promise<BridgeResponse>((resolve) => { complete = resolve; }));
    state.refresh?.(); await settle();
    state.intercept?.({ source: "ai-usage-floating-monitor", direction: "main-to-content", kind: "interceptedUsage", platform: "muse", endpointKey: "muse:subscription", url: "https://muse.ai/", json: { success: false, unauthorized: true }, ts: Date.now() });
    await settle(); complete(response()); await settle();
    expect(state.snapshots.at(-1)?.meters).toEqual([]);
    expect(state.storage["aiUsage:muse:snapshot"]).toBeUndefined();
  });
});
