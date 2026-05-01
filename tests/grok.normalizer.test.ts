import { beforeEach, describe, expect, it } from "vitest";
import {
  clearObservedGrokRateLimitContexts,
  fetchGrokUsage,
  normalizeGrokRateLimit,
  rememberGrokRateLimitContext
} from "../src/platforms/grok";
import type { BridgeResponse, UsageEndpointFetcher } from "../src/platforms/types";

describe("grok normalizer", () => {
  beforeEach(() => {
    clearObservedGrokRateLimitContexts();
  });

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
      key: "grok-3:default:queries",
      remaining: 12,
      total: 20,
      used: 8,
      confidence: "high"
    });
  });

  it("normalizes low and high effort limits", () => {
    const meters = normalizeGrokRateLimit(
      {
        modelName: "grok-4-heavy",
        requestKind: "REASONING",
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
      label: "Grok Heavy · REASONING High / Thinking / Expert",
      remaining: 1,
      resetAfterSeconds: 300
    });
  });

  it("uses model and request kind from the rate-limit payload", () => {
    const meters = normalizeGrokRateLimit({
      modelName: "grok-420-computer-use-sa",
      requestKind: "DEFAULT",
      remainingQueries: 2,
      totalQueries: 5
    });

    expect(meters[0]).toMatchObject({
      key: "grok-420-computer-use-sa:default:queries",
      label: "grok-420-computer-use-sa query limit",
      modelName: "grok-420-computer-use-sa",
      requestKind: "DEFAULT",
      remaining: 2,
      total: 5
    });
  });

  it("does not create meters for missing fields", () => {
    expect(normalizeGrokRateLimit({ ok: true })).toEqual([]);
  });

  it("waits for observed Grok model context before active refresh", async () => {
    const fetcher: UsageEndpointFetcher = async () => {
      throw new Error("should not fetch fixed model candidates");
    };

    const snapshot = await fetchGrokUsage(fetcher);

    expect(snapshot.status).toBe("unknown");
    expect(snapshot.meters).toEqual([]);
  });

  it("refreshes the observed model and request kind dynamically", async () => {
    rememberGrokRateLimitContext({
      modelName: "grok-old",
      requestKind: "DEFAULT"
    });
    rememberGrokRateLimitContext({
      modelName: "grok-420-computer-use-sa",
      requestKind: "DEFAULT"
    });

    const okResponse: BridgeResponse = {
      source: "ai-usage-floating-monitor",
      direction: "main-to-content",
      requestId: "1",
      ok: true,
      platform: "grok",
      endpointKey: "grok:rate-limits",
      json: {
        modelName: "grok-420-computer-use-sa",
        remainingQueries: 3,
        totalQueries: 10
      }
    };
    const calls: unknown[] = [];
    const fetcher: UsageEndpointFetcher = async (endpointKey, payload) => {
      calls.push({ endpointKey, payload });
      return okResponse;
    };

    const snapshot = await fetchGrokUsage(fetcher);

    expect(calls).toEqual([
      {
        endpointKey: "grok:rate-limits",
        payload: {
          modelName: "grok-420-computer-use-sa",
          requestKind: "DEFAULT"
        }
      }
    ]);
    expect(snapshot.status).toBe("ok");
    expect(snapshot.meters).toHaveLength(1);
    expect(snapshot.meters[0].key).toBe(
      "grok-420-computer-use-sa:default:queries"
    );
  });
});
