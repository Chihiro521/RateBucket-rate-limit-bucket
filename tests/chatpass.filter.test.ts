import { describe, expect, it } from "vitest";
import { normalizeChatGptWhamUsage } from "../src/platforms/chatgpt";
import { mergeUsageSnapshots } from "../src/platforms/merge";
import { chatGptPrimaryMeter } from "../src/platforms/presentation";
import { ChatGptUsageController } from "../src/content/chatgptUsageController";
import type { UsageMeter, UsageSnapshot } from "../src/platforms/types";

const extra: UsageMeter = { key: "wham:root.chatpass.windows.0", label: "Chatpass Windows",
  remainingPercent: 100, source: "intercepted", confidence: "medium", observedAt: 1_700_000_000_000 };

describe("ordinary plan windows without ChatPass sublimits", () => {
  it("keeps the actual five-hour and weekly readings unchanged", () => {
    const windows = normalizeChatGptWhamUsage({
      rate_limit: {
        primary_window: { used_percent: 0, limit_window_seconds: 18000 },
        secondary_window: { used_percent: 44, limit_window_seconds: 604800 }
      },
      chatpass: { windows: [
        { used_percent: 0, limit_window_seconds: 604800 },
        { used_percent: 0, limit_window_seconds: 18000 }
      ] }
    });
    expect(windows.map((meter) => meter.key)).toEqual(["wham:primary_window", "wham:secondary_window"]);
    expect(windows.map((meter) => meter.remainingPercent)).toEqual([100, 56]);
  });
  it("also ignores app-sharing windows nested under Codex or alternate field names", () => {
    const windows = normalizeChatGptWhamUsage({
      chat_pass_windows: [{ used_percent: 0 }],
      chatpass: { codex: { primary_window: { used_percent: 0 } } },
      codex: { chatpass: { windows: [{ used_percent: 0 }] } },
      model_rate_limits: [{ label: "Verified model window", used_percent: 12 }]
    });
    expect(windows).toHaveLength(1);
    expect(windows[0].label).toBe("Verified model window");
    expect(windows[0].remainingPercent).toBe(88);
  });
  it("removes retained old ChatPass meters immediately, without dropping real readings", () => {
    const primary = { ...extra, key: "wham:primary_window", label: "5-hour window", remainingPercent: 100 };
    const old: UsageSnapshot = { platform: "chatgpt", scopeKey: "scope", meters: [extra, primary], source: "api", status: "ok", updatedAt: extra.observedAt! };
    const merged = mergeUsageSnapshots(old, { ...old, meters: [primary] }, extra.observedAt! + 1000);
    expect(merged.meters).toEqual([primary]);
    expect(chatGptPrimaryMeter([extra])).toBeUndefined();
  });
  it("cleans restored scoped cache before publishing it to the widget", async () => {
    const old: UsageSnapshot = { platform: "chatgpt", scopeKey: "scope", meters: [extra], source: "api", status: "ok", updatedAt: extra.observedAt! };
    const published: UsageSnapshot[] = [];
    const controller = new ChatGptUsageController({
      now: () => extra.observedAt! + 1000,
      fetcher: async () => { throw new Error("Not used"); },
      readCache: async () => old, writeCache: async () => undefined,
      onLoading: () => undefined, onSnapshot: (snapshot) => { if (snapshot) published.push(snapshot); }
    });
    await controller.acceptIntercept("chatgpt:whamUsage", { rate_limit: { primary_window: { used_percent: 0 } } }, extra.observedAt! + 1000, undefined, "scope");
    expect(published.every((snapshot) => !snapshot.meters.some((meter) => meter.label === "Chatpass Windows"))).toBe(true);
    expect(published.at(-1)!.meters[0].remainingPercent).toBe(100);
  });
});
