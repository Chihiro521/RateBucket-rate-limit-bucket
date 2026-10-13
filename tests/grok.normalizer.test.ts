import { describe, expect, it } from "vitest";
import {
  fetchGrokUsage,
  normalizeGrokCreditsConfig
} from "../src/platforms/grok";
import type { BridgeResponse, UsageEndpointFetcher } from "../src/platforms/types";

const SAMPLE_GROK_CREDITS_CONFIG =
  "AAAAAF8KXQ0AAHBBEgAaACIMCILin9IGEIDiu5MCKgwIgtfE0gYQgOK7kwI6BwgFFQAAAEE6BwgEFQAA4EBCHggCEgwIguKf0gYQgOK7kwIaDAiC18TSBhCA4ruTAlgBYgBoAYAAAAAPZ3JwYy1zdGF0dXM6MA0K";

const ONE_PERCENT_PRODUCT_CONFIG = encodeCreditsConfig([
  { product: 1, usagePercent: 1 },
  { product: 2, usagePercent: 1 }
]);

describe("grok normalizer", () => {
  it("normalizes the Grok credits gRPC-web usage config", () => {
    const meters = normalizeGrokCreditsConfig(SAMPLE_GROK_CREDITS_CONFIG);

    expect(meters).toHaveLength(3);
    expect(meters[0]).toMatchObject({
      key: "grok:weekly:total",
      label: "Weekly Grok limit",
      usedPercent: 15,
      resetAt: "2026-07-10T17:27:30.577Z",
      confidence: "high",
      rawKind: "grokCreditsConfig:total"
    });
    expect(meters[0].remainingPercent).toBeUndefined();

    expect(meters[1]).toMatchObject({
      key: "grok:weekly:imagine",
      label: "Imagine",
      usedPercent: 8,
      rawKind: "grokCreditsConfig:product:5"
    });
    expect(meters[1].remainingPercent).toBeUndefined();

    expect(meters[2]).toMatchObject({
      key: "grok:weekly:chat",
      label: "Chat",
      usedPercent: 7,
      rawKind: "grokCreditsConfig:product:4"
    });
    expect(meters[2].remainingPercent).toBeUndefined();
  });

  it("does not create meters for missing or malformed credits config", () => {
    expect(normalizeGrokCreditsConfig(undefined)).toEqual([]);
    expect(normalizeGrokCreditsConfig("not-base64")).toEqual([]);
  });

  it("treats product usage values as percentage points", () => {
    const meters = normalizeGrokCreditsConfig(ONE_PERCENT_PRODUCT_CONFIG);

    expect(meters[0]).toMatchObject({
      key: "grok:current:total",
      label: "Current Grok limit",
      usedPercent: 2
    });
    expect(meters[1]).toMatchObject({
      key: "grok:current:grok-build",
      label: "Grok Build",
      usedPercent: 1
    });
    expect(meters[2]).toMatchObject({
      key: "grok:current:api",
      label: "API",
      usedPercent: 1
    });
  });

  it("refreshes Grok usage from the credits config endpoint", async () => {
    const okResponse: BridgeResponse = {
      source: "ai-usage-floating-monitor",
      direction: "main-to-content",
      requestId: "1",
      ok: true,
      platform: "grok",
      endpointKey: "grok:credits-config",
      text: SAMPLE_GROK_CREDITS_CONFIG
    };
    const calls: unknown[] = [];
    const fetcher: UsageEndpointFetcher = async (endpointKey, payload) => {
      calls.push({ endpointKey, payload });
      return okResponse;
    };

    const snapshot = await fetchGrokUsage(fetcher);

    expect(calls).toEqual([
      {
        endpointKey: "grok:credits-config",
        payload: undefined
      }
    ]);
    expect(snapshot.status).toBe("ok");
    expect(snapshot.meters).toHaveLength(3);
    expect(snapshot.meters[0].key).toBe("grok:weekly:total");
  });
});

function encodeCreditsConfig(
  productUsage: Array<{ product: number; usagePercent: number }>
): string {
  const config: number[] = [];
  for (const item of productUsage) {
    const product: number[] = [];
    pushVarintField(product, 1, item.product);
    pushFloatField(product, 2, item.usagePercent);
    pushMessageField(config, 7, product);
  }

  const root: number[] = [];
  pushMessageField(root, 1, config);
  return bytesToBase64([
    0,
    ...uint32be(root.length),
    ...root
  ]);
}

function pushVarintField(bytes: number[], field: number, value: number): void {
  bytes.push((field << 3) | 0);
  bytes.push(...varint(value));
}

function pushFloatField(bytes: number[], field: number, value: number): void {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setFloat32(0, value, true);
  bytes.push((field << 3) | 5, ...new Uint8Array(buffer));
}

function pushMessageField(bytes: number[], field: number, value: number[]): void {
  bytes.push((field << 3) | 2, ...varint(value.length), ...value);
}

function varint(value: number): number[] {
  const bytes: number[] = [];
  let current = value;
  do {
    let byte = current & 0x7f;
    current = Math.floor(current / 128);
    if (current > 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (current > 0);
  return bytes;
}

function uint32be(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  ];
}

function bytesToBase64(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes));
}
