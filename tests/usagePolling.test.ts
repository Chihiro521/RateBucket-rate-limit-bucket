import { describe, expect, it, vi } from "vitest";
import {
  CHATGPT_POLL_CHECK_MS,
  sameUsageValues,
  startVisibleUsagePolling,
  withoutOlderMeters
} from "../src/content/usagePolling";
import type { UsageSnapshot } from "../src/platforms/types";

function snapshot(remaining: number, observedAt: number): UsageSnapshot {
  return {
    platform: "chatgpt",
    meters: [{
      key: "limits_progress:image_gen",
      label: "Image Generation",
      remaining,
      resetAt: "2026-09-26T00:00:00Z",
      source: "api",
      confidence: "high",
      observedAt
    }],
    source: "api",
    updatedAt: observedAt,
    status: "ok"
  };
}

describe("ChatGPT usage polling", () => {
  it("polls every minute only while visible and refreshes on return", () => {
    let visible = true;
    let tick: (() => void) | undefined;
    let visibilityChanged: (() => void) | undefined;
    const refresh = vi.fn();
    const clearInterval = vi.fn();
    const stopVisibility = vi.fn();
    const stop = startVisibleUsagePolling({
      isVisible: () => visible,
      onVisibilityChange: (callback) => {
        visibilityChanged = callback;
        return stopVisibility;
      },
      setInterval: (callback, intervalMs) => {
        expect(intervalMs).toBe(CHATGPT_POLL_CHECK_MS);
        tick = callback;
        return 7;
      },
      clearInterval,
      refresh
    });

    tick?.();
    expect(refresh).toHaveBeenCalledTimes(1);
    visible = false;
    tick?.();
    expect(refresh).toHaveBeenCalledTimes(1);
    visible = true;
    visibilityChanged?.();
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
    expect(clearInterval).toHaveBeenCalledWith(7);
    expect(stopVisibility).toHaveBeenCalledOnce();
  });

  it("separates unchanged values from fresh timestamps and changed quota", () => {
    expect(sameUsageValues(snapshot(10, 1_000), snapshot(10, 2_000))).toBe(true);
    expect(sameUsageValues(snapshot(10, 1_000), snapshot(9, 2_000))).toBe(false);
    const changedReset = snapshot(10, 2_000);
    changedReset.meters[0].resetAt = "2026-09-27T00:00:00Z";
    expect(sameUsageValues(snapshot(10, 1_000), changedReset)).toBe(false);
  });

  it("does not let an older request overwrite a newer intercepted meter", () => {
    const newer = snapshot(9, 2_000);
    const older = snapshot(10, 1_000);
    expect(withoutOlderMeters(newer, older).meters).toEqual([]);
    expect(withoutOlderMeters(older, newer).meters[0].remaining).toBe(9);
  });
});
