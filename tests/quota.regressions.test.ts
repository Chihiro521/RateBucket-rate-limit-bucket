import { describe, expect, it } from "vitest";
import { normalizeChatGptConversationInit, normalizeChatGptWhamUsage, normalizeChatGptLibraryStorage } from "../src/platforms/chatgpt";
import { formatMeterValueLocalized, formatResetLocalized } from "../src/utils/i18n";
import { isAlertMeter, meterProgress, chatGptPrimaryMeter } from "../src/platforms/presentation";
import { mergeUsageSnapshots, MERGED_METER_TTL_MS } from "../src/platforms/merge";
import type { UsageMeter, UsageSnapshot } from "../src/platforms/types";

const meter: UsageMeter = { key: "a", label: "a", source: "api", confidence: "high", observedAt: 1_000 };
const snapshot = (m: UsageMeter, scopeKey = "a"): UsageSnapshot => ({ platform: "chatgpt", meters: [m], source: "api", updatedAt: m.observedAt ?? 0, status: "ok", scopeKey });

describe("quota correctness", () => {
  it.each([0, 0.01, 1, 99, 100])("treats used_percent=%s as percentage points", (value) => {
    const m = normalizeChatGptWhamUsage({ rate_limit: { primary_window: { used_percent: value } } })[0];
    expect(m.usedPercent).toBe(value);
    expect(m.remainingPercent).toBe(100 - value);
  });
  it("anchors relative deadlines to reception, including cached snapshots", () => {
    const m = { ...meter, resetAfterSeconds: 3600 };
    expect(formatResetLocalized("zh-CN", m, 1_000)).toBe("1小时");
    expect(formatResetLocalized("zh-CN", structuredClone(m), 1_801_000)).toBe("30分钟");
    expect(formatResetLocalized("en", m, 1_801_000)).toBe("30m");
  });
  it("gives explicit blocking precedence over a simultaneous image 120", () => {
    const result = normalizeChatGptConversationInit({ limits_progress: [{ feature_name: "image_gen", remaining: 120 }], blocked_features: ["image_gen"] });
    expect(result.meters).toHaveLength(1);
    expect(result.meters[0].quotaState).toBe("blocked");
    expect(formatMeterValueLocalized("zh-CN", result.meters[0])).toBe("已达上限");
    expect(result.meters[0].remaining).not.toBe(0);
  });
  it("preserves a reliable block against uncalibrated image data until TTL", () => {
    const blocked = { ...meter, key: "limits_progress:image_gen", quotaState: "blocked" as const };
    const unknown = { ...blocked, remaining: 120, quotaState: "unknown" as const, observedAt: 2_000 };
    expect(mergeUsageSnapshots(snapshot(blocked), snapshot(unknown), 2_000).meters[0].quotaState).toBe("blocked");
    const expired = mergeUsageSnapshots(snapshot(blocked), snapshot(unknown), MERGED_METER_TTL_MS + 3_000).meters[0];
    expect(expired.quotaState).toBe("unknown");
    expect(expired.remaining).toBeNull();
  });
  it("keeps image values but labels them uncalibrated without inventing a total", () => {
    const m = normalizeChatGptConversationInit({ limits_progress: [{ feature_name: "image_gen", remaining: 120 }] }).meters[0];
    expect(m.remaining).toBe(120); expect(m.confidence).toBe("low"); expect(m.quotaState).toBe("unknown");
    expect(meterProgress(m)).toBeNull();
  });
  it("displays zero optional balances without exhausting the capsule", () => {
    const meters = normalizeChatGptWhamUsage({ rate_limit: { primary_window: { used_percent: 1 } }, credits: { balance: "0" }, rate_limit_reset_credits: { available_count: 0 } });
    expect(meters.filter(isAlertMeter)).toHaveLength(0);
    expect(chatGptPrimaryMeter(meters)?.remainingPercent).toBe(99);
    expect(meters.find((m) => m.key === "wham:resetCredits")?.remaining).toBe(0);
  });
  it("does not turn missing reset counts or capacity fields into zero", () => {
    expect(normalizeChatGptWhamUsage({ rate_limit_reset_credits: { available_count: null } })).toHaveLength(0);
    expect(normalizeChatGptLibraryStorage({ allowed_bytes: 20, used_bytes: null })).toHaveLength(0);
  });
  it("formats byte precision using GiB and used capacity progress", () => {
    const m = normalizeChatGptLibraryStorage({ used_bytes: 4 * 1073741824, allowed_bytes: 20 * 1073741824, remaining_bytes: 16 * 1073741824 })[0];
    expect(m.remaining).toBe(16 * 1073741824);
    expect(formatMeterValueLocalized("zh-CN", m)).toBe("剩余 16 GiB");
    expect(formatMeterValueLocalized("en", m)).toBe("Remaining 16 GiB");
    expect(meterProgress(m)).toBe(20);
  });
  it("isolates accounts and rejects delayed requests despite late reception", () => {
    const current = { ...meter, remaining: 8, observedAt: 2_000, requestStartedAt: 2_000 };
    const late = { ...meter, remaining: 9, observedAt: 3_000, requestStartedAt: 1_000 };
    expect(mergeUsageSnapshots(snapshot(current), snapshot(late), 3_000).meters[0].remaining).toBe(8);
    expect(mergeUsageSnapshots(snapshot(current, "a"), snapshot(late, "b"), 3_000).meters[0].remaining).toBe(9);
  });
});
