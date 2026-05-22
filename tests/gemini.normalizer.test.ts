import { describe, expect, it } from "vitest";
import { fetchPlatformUsage } from "../src/platforms";
import { detectPlatform } from "../src/platforms/detect";
import {
  normalizeGeminiUsageText,
  parseGeminiBatchExecuteFrames
} from "../src/platforms/gemini";
import type { BridgeResponse, UsageEndpointFetcher } from "../src/platforms/types";

function successResponse(payload: unknown): string {
  return [
    ")]}'",
    "",
    "201",
    JSON.stringify([
      [
        "wrb.fr",
        "jSf9Qc",
        JSON.stringify(payload),
        null,
        null,
        null,
        "generic"
      ],
      ["di", 455],
      ["af.httprm", 454, "...", 2]
    ]),
    "25",
    JSON.stringify([["e", 4, null, null, 237]])
  ].join("\n");
}

describe("gemini normalizer", () => {
  it("detects gemini.google.com as Gemini", () => {
    expect(detectPlatform({ hostname: "gemini.google.com" } as Location)).toBe(
      "gemini"
    );
  });

  it("normalizes the free Gemini usage buckets", () => {
    const parsed = normalizeGeminiUsageText(
      successResponse([
        1,
        [
          [599, 0.01, 1, [[1779442614, 980412000]]],
          [11937, 0.01312496, 2, [[1779993414, 980543000]]]
        ],
        false
      ])
    );

    expect(parsed.errorMessage).toBeUndefined();
    expect(parsed.payloadStatus).toBe(1);
    expect(parsed.meters).toHaveLength(2);
    expect(parsed.meters[0]).toMatchObject({
      key: "gemini:5h",
      label: "Gemini 5h",
      remaining: 599,
      total: 605,
      usedPercent: 1,
      remainingPercent: 99,
      resetAt: 1779442614980,
      windowSeconds: 18_000,
      source: "api",
      confidence: "high",
      rawKind: "type:1"
    });
    expect(parsed.meters[1]).toMatchObject({
      key: "gemini:weekly",
      label: "Gemini weekly",
      remaining: 11937,
      resetAt: 1779993414981,
      windowSeconds: 604_800,
      rawKind: "type:2"
    });
    expect(parsed.meters[1].usedPercent).toBeCloseTo(1.312496, 6);
    expect(parsed.meters[1].remainingPercent).toBeCloseTo(98.687504, 6);
  });

  it("normalizes the pro Gemini usage buckets", () => {
    const parsed = normalizeGeminiUsageText(
      successResponse([
        2,
        [
          [2277, 0.05, 1, [[1779446440, 527781000]]],
          [45244, 0.06488441, 2, [[1779799240, 527944000]]]
        ],
        false
      ])
    );

    expect(parsed.payloadStatus).toBe(2);
    expect(parsed.meters[0]).toMatchObject({
      remaining: 2277,
      total: 2397,
      usedPercent: 5,
      remainingPercent: 95,
      resetAt: 1779446440528
    });
    expect(parsed.meters[1]).toMatchObject({
      remaining: 45244,
      resetAt: 1779799240528
    });
    expect(parsed.meters[1].usedPercent).toBeCloseTo(6.488441, 6);
    expect(parsed.meters[1].remainingPercent).toBeCloseTo(93.511559, 6);
  });

  it("keeps sub-percent remaining values as percentages", () => {
    const parsed = normalizeGeminiUsageText(
      successResponse([
        2,
        [[5, 0.995, 1, [[1779446440, 527781000]]]],
        false
      ])
    );

    expect(parsed.meters[0].usedPercent).toBeCloseTo(99.5, 6);
    expect(parsed.meters[0].remainingPercent).toBeCloseTo(0.5, 6);
  });

  it("skips XSSI prefixes and batchexecute length lines", () => {
    const frames = parseGeminiBatchExecuteFrames(successResponse([2, [], false]));

    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual([
      ["wrb.fr", "jSf9Qc", "[2,[],false]", null, null, null, "generic"],
      ["di", 455],
      ["af.httprm", 454, "...", 2]
    ]);
  });

  it("reports Gemini RPC error frames", () => {
    const parsed = normalizeGeminiUsageText(
      [
        ")]}'",
        "",
        "103",
        JSON.stringify([
          ["er", null, null, null, null, 400, null, null, null, 3],
          ["di", 14],
          ["af.httprm", 13, "...", 1]
        ])
      ].join("\n")
    );

    expect(parsed.meters).toEqual([]);
    expect(parsed.errorStatus).toBe(400);
    expect(parsed.errorMessage).toBe("Gemini usage RPC failed (400)");
  });

  it("returns parser errors for malformed responses", () => {
    expect(normalizeGeminiUsageText("not json").errorMessage).toBe(
      "Gemini batchexecute 响应结构变化"
    );
    expect(
      normalizeGeminiUsageText(")]}'\n12\n[[\"di\",455]]").errorMessage
    ).toBe("Gemini usage payload missing");
    expect(
      normalizeGeminiUsageText(
        ")]}'\n12\n" +
          JSON.stringify([["wrb.fr", "jSf9Qc", "{bad json", null]])
      ).errorMessage
    ).toBe("Gemini usage payload parse failed");
  });

  it("fetches Gemini through the platform dispatcher", async () => {
    const calls: unknown[] = [];
    const okResponse: BridgeResponse = {
      source: "ai-usage-floating-monitor",
      direction: "main-to-content",
      requestId: "1",
      ok: true,
      platform: "gemini",
      endpointKey: "gemini:usageBatchExecute",
      text: successResponse([
        2,
        [[2277, 0.05, 1, [[1779446440, 527781000]]]],
        false
      ])
    };
    const fetcher: UsageEndpointFetcher = async (endpointKey, payload) => {
      calls.push({ endpointKey, payload });
      return okResponse;
    };

    const snapshot = await fetchPlatformUsage("gemini", fetcher);

    expect(calls).toEqual([
      {
        endpointKey: "gemini:usageBatchExecute",
        payload: undefined
      }
    ]);
    expect(snapshot.status).toBe("ok");
    expect(snapshot.debug?.parser).toBe("gemini.status=2");
    expect(snapshot.meters[0].key).toBe("gemini:5h");
  });

  it("waits without backoff when Gemini replay params are not ready", async () => {
    const fetcher: UsageEndpointFetcher = async () => ({
      source: "ai-usage-floating-monitor",
      direction: "main-to-content",
      requestId: "1",
      ok: false,
      platform: "gemini",
      endpointKey: "gemini:usageBatchExecute",
      error: {
        message: "Missing Gemini usage replay parameters"
      }
    });

    const snapshot = await fetchPlatformUsage("gemini", fetcher);

    expect(snapshot.status).toBe("unknown");
    expect(snapshot.errorMessage).toBe("等待 Gemini 页面用量参数");
  });
});
