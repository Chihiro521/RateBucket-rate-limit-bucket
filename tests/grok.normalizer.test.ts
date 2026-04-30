import { describe, expect, it } from "vitest";
import { fetchGrokUsage, normalizeGrokRateLimit } from "../src/platforms/grok";
import type { BridgeResponse, UsageEndpointFetcher } from "../src/platforms/types";

describe("grok normalizer", () => {
  it("normalizes remainingQueries and totalQueries", () => {
    const meters = normalizeGrokRateLimit(
      {
        remainingQueries: 12,
        totalQueries: 20,
        windowSizeSeconds: 3600
      },
      { modelName: "grok-3", labelPrefix: "Grok" }
    );

    expect(meters).toHaveLength(1);
    expect(meters[0]).toMatchObject({
      key: "grok-3:queries",
      remaining: 12,
      total: 20,
      used: 8,
      confidence: "high"
    });
  });

  it("normalizes low and high effort limits", () => {
    const meters = normalizeGrokRateLimit(
      {
        lowEffortRateLimits: {
          remainingQueries: 5,
          totalQueries: 10,
          waitTimeSeconds: 60
        },
        highEffortRateLimits: {
          remainingQueries: 1,
          totalQueries: 4,
          waitTimeSeconds: 300,
          cost: 2
        }
      },
      { modelName: "grok-4-heavy", labelPrefix: "Grok Heavy" }
    );

    expect(meters.map((meter) => meter.rawKind)).toEqual([
      "lowEffortRateLimits",
      "highEffortRateLimits"
    ]);
    expect(meters[1]).toMatchObject({
      label: "Grok Heavy High / Thinking / Expert",
      remaining: 1,
      resetAfterSeconds: 300
    });
  });

  it("does not create meters for missing fields", () => {
    expect(normalizeGrokRateLimit({ ok: true })).toEqual([]);
  });

  it("returns partial when one model succeeds and another fails", async () => {
    const okResponse: BridgeResponse = {
      source: "ai-usage-floating-monitor",
      direction: "main-to-content",
      requestId: "1",
      ok: true,
      platform: "grok",
      endpointKey: "grok:grok-3",
      json: {
        remainingQueries: 3,
        totalQueries: 10
      }
    };
    const failResponse: BridgeResponse = {
      source: "ai-usage-floating-monitor",
      direction: "main-to-content",
      requestId: "2",
      ok: false,
      platform: "grok",
      endpointKey: "grok:grok-4-heavy",
      error: { status: 500, message: "server error" }
    };
    const fetcher: UsageEndpointFetcher = async (endpointKey) =>
      endpointKey === "grok:grok-3" ? okResponse : failResponse;

    const snapshot = await fetchGrokUsage(fetcher);

    expect(snapshot.status).toBe("partial");
    expect(snapshot.meters).toHaveLength(1);
    expect(snapshot.errorMessage).toContain("500");
  });
});
