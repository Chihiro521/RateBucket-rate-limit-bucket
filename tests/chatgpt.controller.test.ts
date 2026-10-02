import { describe, expect, it, vi } from "vitest";
import { ChatGptUsageController } from "../src/content/chatgptUsageController";
import { MERGED_METER_TTL_MS } from "../src/platforms/merge";
import type { BridgeResponse, EndpointKey, UsageSnapshot } from "../src/platforms/types";

const data = (key: EndpointKey) => key === "chatgpt:conversationInit" ? { limits_progress: [{ feature_name: "deep_research", remaining: 22 }] }
  : key === "chatgpt:libraryStorage" ? { used_bytes: 4, allowed_bytes: 20, remaining_bytes: 16 }
  : { rate_limit: { primary_window: { used_percent: 1 } } };
const response = (key: EndpointKey, json = data(key)): BridgeResponse => ({ source: "ai-usage-floating-monitor", direction: "main-to-content", requestId: key, platform: "chatgpt", endpointKey: key, ok: true, json, scopeKey: "scope-a" });
const subscription = (expiresAt: string) => ({ accounts: { default: { entitlement: {
  has_active_subscription: true, subscription_plan: "plus", expires_at: expiresAt
} } } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
function setup(fetcher: (key: EndpointKey) => Promise<BridgeResponse>) {
  let now = 1_700_000_000_000;
  let latest: UsageSnapshot | null = null;
  const readCache = vi.fn(async (_scope: string): Promise<UsageSnapshot | null> => null), writeCache = vi.fn(async () => undefined);
  const controller = new ChatGptUsageController({ fetcher, now: () => now, onSnapshot: (s) => { latest = s; }, onLoading: vi.fn(), readCache, writeCache });
  return { controller, latest: () => latest, advance: (n: number) => { now += n; }, readCache, writeCache };
}

describe("ChatGPT refresh controller", () => {
  it("queries concurrently, publishes fast data before slow endpoints, and joins flights", async () => {
    const slow = deferred<BridgeResponse>();
    const fetcher = vi.fn(async (key: EndpointKey) => key === "chatgpt:libraryStorage" ? slow.promise : response(key));
    const s = setup(fetcher);
    const first = s.controller.refresh("startup");
    await vi.waitFor(() => expect(s.latest()?.meters.length).toBe(2));
    const second = s.controller.refresh("manual");
    expect(fetcher).toHaveBeenCalledTimes(3);
    slow.resolve(response("chatgpt:libraryStorage"));
    await Promise.all([first, second]);
    expect(s.latest()?.meters.length).toBe(3);
  });
  it("uses a 30 second TTL independently for each endpoint", async () => {
    const fetcher = vi.fn(async (key: EndpointKey) => response(key)); const s = setup(fetcher);
    await s.controller.refresh("startup"); s.advance(29_999); await s.controller.refresh(); expect(fetcher).toHaveBeenCalledTimes(3);
    s.advance(1); await s.controller.refresh(); expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it("bypasses ordinary cache on an operation but debounces within five seconds", async () => {
    const fetcher = vi.fn(async (key: EndpointKey) => response(key)); const s = setup(fetcher);
    await s.controller.refresh("startup"); s.advance(1_500); await s.controller.refresh("operation");
    expect(fetcher).toHaveBeenCalledTimes(6); await s.controller.refresh("operation"); expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it("retains successful timestamps on failure and does not back off healthy sources", async () => {
    let fail = false;
    const fetcher = vi.fn(async (key: EndpointKey) => fail && key === "chatgpt:whamUsage" ? { ...response(key), ok: false, error: { status: 403, message: "Denied" } } : response(key));
    const s = setup(fetcher); await s.controller.refresh("startup");
    const old = s.latest()!.meters.find((m) => m.key === "wham:primary_window")!.observedAt;
    fail = true; s.advance(30_000); await s.controller.refresh();
    expect(s.latest()!.meters.find((m) => m.key === "wham:primary_window")!.observedAt).toBe(old);
    s.advance(30_000); await s.controller.refresh();
    expect(fetcher.mock.calls.filter(([key]) => key === "chatgpt:whamUsage")).toHaveLength(2);
    expect(fetcher.mock.calls.filter(([key]) => key === "chatgpt:conversationInit")).toHaveLength(3);
  });
  it("a passive feature update does not postpone unrelated plan quota checks", async () => {
    const fetcher = vi.fn(async (key: EndpointKey) => response(key)); const s = setup(fetcher);
    await s.controller.refresh("startup"); s.advance(25_000);
    await s.controller.acceptIntercept("chatgpt:conversationInit", data("chatgpt:conversationInit"), 1_700_000_025_000, undefined, "scope-a");
    s.advance(5_000); await s.controller.refresh();
    expect(fetcher.mock.calls.filter(([key]) => key === "chatgpt:conversationInit")).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([key]) => key === "chatgpt:whamUsage")).toHaveLength(2);
  });
  it("discards old in-flight responses after an account switch", async () => {
    const slow = deferred<BridgeResponse>(); const s = setup(() => slow.promise);
    const old = s.controller.refresh(); s.controller.reset(); slow.resolve(response("chatgpt:whamUsage")); await old;
    expect(s.latest()).toBeNull(); expect(s.writeCache).not.toHaveBeenCalled();
  });
  it("does not persist or reuse an unscoped account", async () => {
    const s = setup(async (key) => ({ ...response(key), scopeKey: undefined })); await s.controller.refresh();
    expect(s.latest()?.meters.length).toBe(3); expect(s.readCache).not.toHaveBeenCalled(); expect(s.writeCache).not.toHaveBeenCalled();
  });

  it("keeps subscription calibration during unrelated quota refreshes beyond 30 minutes", async () => {
    const fetcher = vi.fn(async (key: EndpointKey) => response(key));
    const s = setup(fetcher);
    await s.controller.acceptIntercept("chatgpt:accountsCheck", subscription("2026-10-18T04:06:08Z"), 1_700_000_000_000, undefined, "scope-a");
    const original = s.latest()!.meters[0];
    await s.controller.refresh("startup");
    s.advance(MERGED_METER_TTL_MS + 1);
    await s.controller.refresh();
    expect(s.latest()!.meters.find((meter) => meter.key === original.key)).toEqual(original);
    expect(fetcher.mock.calls.some(([key]) => key === "chatgpt:accountsCheck")).toBe(false);
  });

  it("keeps an expired subscription when queries fail while stale quotas are removed", async () => {
    const s = setup(async (key) => ({ ...response(key), ok: false }));
    await s.controller.acceptIntercept("chatgpt:accountsCheck", subscription("2023-11-14T22:14:20Z"), 1_700_000_000_000, undefined, "scope-a");
    const original = s.latest()!.meters[0];
    await s.controller.acceptIntercept("chatgpt:conversationInit", data("chatgpt:conversationInit"), 1_700_000_000_000, undefined, "scope-a");
    s.advance(MERGED_METER_TTL_MS + 1);
    await s.controller.refresh();
    expect(s.latest()!.meters).toEqual([original]);
    expect(s.latest()!.status).toBe("partial");
  });

  it("recalibrates from a new subscription response and ignores an older request arriving later", async () => {
    const s = setup(async (key) => response(key));
    await s.controller.acceptIntercept("chatgpt:accountsCheck", subscription("2026-10-18T04:06:08Z"), 1_700_000_000_000, undefined, "scope-a");
    s.advance(MERGED_METER_TTL_MS + 1);
    const observedAt = 1_700_000_000_000 + MERGED_METER_TTL_MS + 1;
    await s.controller.acceptIntercept("chatgpt:accountsCheck", subscription("2026-11-18T04:06:08Z"), observedAt, observedAt, "scope-a");
    const calibrated = s.latest()!.meters[0];
    expect(calibrated).toMatchObject({ resetAt: "2026-11-18T04:06:08Z", observedAt });
    await s.controller.acceptIntercept("chatgpt:accountsCheck", subscription("2026-10-18T04:06:08Z"), observedAt + 1, 1_700_000_000_000, "scope-a");
    expect(s.latest()!.meters[0]).toEqual(calibrated);
    s.controller.reset();
    await s.controller.refresh("startup");
    expect(s.latest()!.meters.some((meter) => meter.key === "chatgpt:subscription")).toBe(false);
  });

  it("restores an old subscription only from its matching account cache", async () => {
    const s = setup(async (key) => response(key));
    const oldTime = 1_700_000_000_000 - MERGED_METER_TTL_MS - 1;
    const cached: UsageSnapshot = { platform: "chatgpt", scopeKey: "scope-a", source: "intercepted", updatedAt: oldTime, status: "ok", meters: [{
      key: "chatgpt:subscription", label: "ChatGPT subscription", rawKind: "chatgpt.subscription", metricKind: "subscription",
      resetAt: "2026-10-18T04:06:08Z", source: "intercepted", confidence: "high", observedAt: oldTime
    }] };
    s.readCache.mockImplementation(async (scope) => scope === "scope-a" ? cached : null);
    await s.controller.refresh("startup");
    expect(s.latest()!.meters.find((meter) => meter.key === "chatgpt:subscription")).toEqual(cached.meters[0]);
    await s.controller.acceptIntercept("chatgpt:conversationInit", data("chatgpt:conversationInit"), 1_700_000_000_001, undefined, "scope-b");
    expect(s.latest()!.meters.some((meter) => meter.key === "chatgpt:subscription")).toBe(false);
  });
});
