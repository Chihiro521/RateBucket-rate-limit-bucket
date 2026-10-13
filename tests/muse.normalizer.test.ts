import { describe, expect, it } from "vitest";
import { detectPlatform } from "../src/platforms/detect";
import { fetchPlatformUsage } from "../src/platforms";
import { normalizeInterceptedUsage } from "../src/platforms/intercepted";
import { mergeMuseUsageSnapshots, museSnapshotFromResult, normalizeMuseUsage, parseMuseSubscriptionJson, parseMuseSubscriptionText } from "../src/platforms/muse";
import { hasMeaningfulValue, isAlertMeter, meterProgress } from "../src/platforms/presentation";
import { sameUsageValues } from "../src/content/usagePolling";
import { formatMeterValueLocalized } from "../src/utils/i18n";
import { MUSE_RESPONSE, museRsc } from "./museFixture";

describe("Muse quota normalization", () => {
  it("detects only the supported Muse app origin", () => {
    expect(detectPlatform({ hostname: "muse.ai" } as Location)).toBe("muse");
    expect(detectPlatform({ hostname: "auth.muse.ai" } as Location)).toBeNull();
    expect(detectPlatform({ hostname: "muse.ai.example.com" } as Location)).toBeNull();
  });

  it("parses Flight model rows and projects quota fields without billing data", () => {
    const parsed = parseMuseSubscriptionText(`a:I["import"]\r\n3:broken\r\n${museRsc()}`);
    expect(parsed?.success).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain("synthetic-billing-data");
    expect(JSON.stringify(parsed)).not.toContain("agreement");
    expect(parseMuseSubscriptionText("<html>sign in</html>")).toBeNull();
    expect(parseMuseSubscriptionText('1:E{"message":"error"}\n')).toBeNull();
  });

  it("normalizes real weekly percentage, reset date and official top-up text", () => {
    const meters = normalizeMuseUsage(MUSE_RESPONSE);
    expect(meters).toHaveLength(2);
    expect(meters[0]).toMatchObject({ key: "muse:weekly", usedPercent: 45, remainingPercent: 55, resetAt: 1792246921000, confidence: "high" });
    expect(new Date(meters[0].resetAt as number).toISOString()).toBe("2026-10-17T14:22:01.000Z");
    expect(meters[1]).toMatchObject({ key: "muse:topup", usedPercent: 0, remainingPercent: 100, metricKind: "balance", displayValue: MUSE_RESPONSE.subscription.topupRowValueLabel });
    expect(meters[1].remaining).toBeUndefined();
    expect(formatMeterValueLocalized("zh-CN", meters[1])).toContain("10 亿个词元");
    expect(formatMeterValueLocalized("zh-CN", meters[1])).not.toContain("40000000");
    expect(meterProgress(meters[1])).toBeNull();
  });

  it("retains an exhausted extra balance without treating it as the weekly limit", () => {
    const meters = normalizeMuseUsage({ ...MUSE_RESPONSE, subscription: { ...MUSE_RESPONSE.subscription, topupBalance: 0, topupRowValueLabel: "已使用 100%（剩余 0 个词元）" } });
    expect(meters[1].usedPercent).toBe(100);
    expect(isAlertMeter(meters[1])).toBe(false);
    expect(normalizeMuseUsage({ ...MUSE_RESPONSE, subscription: { ...MUSE_RESPONSE.subscription, topupTotal: 0 } })).toHaveLength(1);
  });

  it("uses each response's extra balance and official token text without a fixed conversion", () => {
    const changed = normalizeMuseUsage({ ...MUSE_RESPONSE, subscription: {
      ...MUSE_RESPONSE.subscription, topupBalance: 23_600_000, topupTotal: 80_000_000,
      topupRowValueLabel: "已使用 71%（剩余 5.9 亿个词元）"
    } });
    expect(changed[1]).toMatchObject({ usedPercent: 71, remainingPercent: 29, displayValue: "已使用 71%（剩余 5.9 亿个词元）" });
    expect(formatMeterValueLocalized("zh-CN", changed[1])).toBe("已使用 71%（剩余 5.9 亿个词元）");
    const previous = museSnapshotFromResult(parseMuseSubscriptionJson(MUSE_RESPONSE), "api", 1000);
    const next = { ...previous, meters: previous.meters.map((meter) => meter.key === "muse:topup"
      ? { ...meter, displayValue: "已使用 0%（剩余 9.99 亿个词元）" } : meter) };
    expect(sameUsageValues(previous, next)).toBe(false);
  });

  it("does not manufacture zero quota from missing or invalid fields", () => {
    const meters = normalizeMuseUsage({ success: true, subscription: { usage: { state: "METERED", percentUsed: "unknown" }, topupBalance: 12, topupTotal: null } });
    expect(meters).toHaveLength(1);
    expect(meters[0]).toMatchObject({ quotaState: "unknown", confidence: "low" });
    expect(meters[0].usedPercent).toBeUndefined();
    expect(meters[0].remainingPercent).toBeUndefined();
    expect(museSnapshotFromResult(parseMuseSubscriptionJson({ success: true, subscription: {} }), "api", 1000)).toMatchObject({ status: "error", errorCode: "PARSER_ERROR", checkedAt: undefined });
  });

  it("supports unlimited and unfamiliar usage states", () => {
    const unlimited = normalizeMuseUsage({ success: true, subscription: { usage: { state: "UNLIMITED", percentUsed: 100 } } })[0];
    expect(formatMeterValueLocalized("zh-CN", unlimited)).toBe("无限");
    expect(formatMeterValueLocalized("en", unlimited)).toBe("Unlimited");
    expect(hasMeaningfulValue(unlimited)).toBe(true);
    expect(isAlertMeter(unlimited)).toBe(false);
    expect(meterProgress(unlimited)).toBeNull();
    expect(normalizeMuseUsage({ success: true, subscription: { usage: { state: "PROVISIONING", percentUsed: 0 } } })[0].quotaState).toBe("unknown");
  });

  it("dispatches active queries and shares the parser with intercepted responses", async () => {
    const active = await fetchPlatformUsage("muse", async (endpointKey) => {
      expect(endpointKey).toBe("muse:subscription");
      return { source: "ai-usage-floating-monitor", direction: "main-to-content", requestId: "1", platform: "muse", ok: true, text: museRsc(), requestStartedAt: 900, observedAt: 1000 };
    });
    const passive = normalizeInterceptedUsage({ platform: "muse", url: "https://muse.ai/", json: parseMuseSubscriptionText(museRsc()), ts: 1000, requestStartedAt: 900 });
    expect(active).toMatchObject({ status: "ok", checkedAt: 1000 });
    expect(passive.meters.map((meter) => ({ ...meter, source: "api" }))).toEqual(active.meters);
  });

  it("clears readings on authentication failure and keeps last successful check during network failure", async () => {
    const previous = museSnapshotFromResult(parseMuseSubscriptionJson(MUSE_RESPONSE), "api", 1000, 900);
    const unauthorized = await fetchPlatformUsage("muse", async () => ({ source: "ai-usage-floating-monitor", direction: "main-to-content", requestId: "1", platform: "muse", ok: false, error: { status: 401, message: "Unauthorized" } }));
    expect(mergeMuseUsageSnapshots(previous, unauthorized).meters).toEqual([]);
    const failed = { ...unauthorized, updatedAt: 2000, errorCode: "NETWORK_ERROR" as const, errorMessage: "Network failure" };
    const retained = mergeMuseUsageSnapshots(previous, failed, 2000);
    expect(retained).toMatchObject({ status: "partial", checkedAt: 1000, updatedAt: 1000, errorMessage: "Network failure" });
    expect(retained.meters).toEqual(previous.meters);
    expect(museSnapshotFromResult(parseMuseSubscriptionText(museRsc({ success: false, sessionRecovery: { scope: "hatch", reason: "authentication" } })), "intercepted", 2000).errorCode).toBe("UNAUTHORIZED");
  });

  it("rejects delayed readings, replaces removed extra quota, and detects changed display text", () => {
    const newer = museSnapshotFromResult(parseMuseSubscriptionJson(MUSE_RESPONSE), "api", 2000, 1800);
    const older = museSnapshotFromResult(parseMuseSubscriptionJson(MUSE_RESPONSE), "api", 3000, 900);
    expect(mergeMuseUsageSnapshots(newer, older)).toBe(newer);
    const noExtra = museSnapshotFromResult(parseMuseSubscriptionJson({ ...MUSE_RESPONSE, subscription: { ...MUSE_RESPONSE.subscription, topupTotal: 0 } }), "api", 4000);
    expect(mergeMuseUsageSnapshots(newer, noExtra).meters).toHaveLength(1);
    const changed = { ...newer, meters: newer.meters.map((meter) => ({ ...meter, displayValue: "Updated balance" })) };
    expect(sameUsageValues(newer, changed)).toBe(false);
  });
});
