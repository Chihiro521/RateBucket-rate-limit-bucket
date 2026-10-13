import { describe, expect, it } from "vitest";
import { fetchPlatformUsage } from "../src/platforms";
import { detectPlatform } from "../src/platforms/detect";
import { normalizePerplexityRateLimit } from "../src/platforms/perplexity";
import type { BridgeResponse, UsageEndpointFetcher } from "../src/platforms/types";

const SAMPLE_RESPONSE = {
  model_specific_limits: {},
  remaining_agentic_research: 0,
  remaining_labs: 25,
  remaining_pro: 193,
  remaining_research: 7
};

describe("perplexity normalizer", () => {
  it("detects perplexity.ai as Perplexity", () => {
    expect(detectPlatform({ hostname: "www.perplexity.ai" } as Location)).toBe(
      "perplexity"
    );
    expect(detectPlatform({ hostname: "perplexity.ai" } as Location)).toBe(
      "perplexity"
    );
  });

  it("normalizes the rate-limit response", () => {
    const meters = normalizePerplexityRateLimit(SAMPLE_RESPONSE);

    expect(meters).toHaveLength(4);
    expect(meters).toEqual([
      expect.objectContaining({
        key: "perplexity:pro",
        label: "Pro",
        remaining: 193,
        total: null,
        source: "api",
        confidence: "medium",
        rawKind: "remaining_pro"
      }),
      expect.objectContaining({
        key: "perplexity:research",
        label: "Deep Research",
        remaining: 7,
        rawKind: "remaining_research"
      }),
      expect.objectContaining({
        key: "perplexity:labs",
        label: "Labs",
        remaining: 25,
        rawKind: "remaining_labs"
      }),
      expect.objectContaining({
        key: "perplexity:agentic-research",
        label: "Agentic Research",
        remaining: 0,
        rawKind: "remaining_agentic_research"
      })
    ]);
  });

  it("skips missing or non-numeric fields", () => {
    expect(
      normalizePerplexityRateLimit({
        remaining_pro: "12",
        remaining_research: null,
        remaining_labs: "soon",
        remaining_agentic_research: 0
      }).map((meter) => [meter.key, meter.remaining])
    ).toEqual([
      ["perplexity:pro", 12],
      ["perplexity:agentic-research", 0]
    ]);
  });

  it("normalizes model-specific limits when shape is explicit", () => {
    const meters = normalizePerplexityRateLimit({
      model_specific_limits: {
        sonar_reasoning: {
          remaining: 3,
          limit: 10
        }
      }
    });

    expect(meters).toHaveLength(1);
    expect(meters[0]).toMatchObject({
      key: "perplexity:model:sonar_reasoning",
      label: "Sonar Reasoning model limit",
      modelName: "sonar_reasoning",
      remaining: 3,
      total: 10,
      used: 7,
      remainingPercent: 30,
      source: "api",
      confidence: "high"
    });
  });

  it("fetches Perplexity through the platform dispatcher", async () => {
    const calls: unknown[] = [];
    const okResponse: BridgeResponse = {
      source: "ai-usage-floating-monitor",
      direction: "main-to-content",
      requestId: "1",
      ok: true,
      platform: "perplexity",
      endpointKey: "perplexity:rateLimitAll",
      json: SAMPLE_RESPONSE
    };
    const fetcher: UsageEndpointFetcher = async (endpointKey, payload) => {
      calls.push({ endpointKey, payload });
      return okResponse;
    };

    const snapshot = await fetchPlatformUsage("perplexity", fetcher);

    expect(calls).toEqual([
      {
        endpointKey: "perplexity:rateLimitAll",
        payload: undefined
      }
    ]);
    expect(snapshot.status).toBe("ok");
    expect(snapshot.source).toBe("api");
    expect(snapshot.debug?.parser).toBe("perplexity.rateLimitAll");
    expect(snapshot.meters[0].key).toBe("perplexity:pro");
  });

  it("reports parser failure when known fields are absent", async () => {
    const fetcher: UsageEndpointFetcher = async () => ({
      source: "ai-usage-floating-monitor",
      direction: "main-to-content",
      requestId: "1",
      ok: true,
      platform: "perplexity",
      endpointKey: "perplexity:rateLimitAll",
      json: { model_specific_limits: {} }
    });

    const snapshot = await fetchPlatformUsage("perplexity", fetcher);

    expect(snapshot.status).toBe("error");
    expect(snapshot.errorMessage).toBe("Perplexity rate-limit fields missing");
  });
});
