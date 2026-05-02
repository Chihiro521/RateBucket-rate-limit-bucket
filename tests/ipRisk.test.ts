import { describe, expect, it } from "vitest";
import {
  ipRiskLabel,
  maskProxycheckApiKey,
  normalizeProxycheckResponse,
  proxycheckRequestUrl,
  sanitizeProxycheckApiKey
} from "../src/platforms/ipRisk";

describe("ip risk", () => {
  it("builds a proxycheck request without leaking page context", () => {
    const url = new URL(proxycheckRequestUrl("abc123", "203.0.113.10"));
    expect(url.origin).toBe("https://proxycheck.io");
    expect(url.pathname).toBe("/v2/203.0.113.10");
    expect(url.searchParams.get("key")).toBe("abc123");
    expect(url.searchParams.get("vpn")).toBe("1");
    expect(url.searchParams.get("risk")).toBe("1");
  });

  it("normalizes proxycheck v2 risk and signals", () => {
    const state = normalizeProxycheckResponse(
      {
        status: "ok",
        ip: "203.0.113.10",
        "203.0.113.10": {
          proxy: "yes",
          type: "VPN",
          risk: "55"
        }
      },
      123
    );

    expect(state).toMatchObject({
      provider: "proxycheck",
      source: "proxycheck.io",
      status: "ok",
      updatedAt: 123,
      score: 55,
      label: "高",
      signals: {
        proxy: true,
        vpn: true,
        tor: false,
        hosting: false,
        type: "VPN"
      }
    });
    expect(JSON.stringify(state)).not.toContain("203.0.113.10");
  });

  it("maps missing obvious proxy signals to a normal score", () => {
    const state = normalizeProxycheckResponse({
      status: "ok",
      ip: "198.51.100.20",
      "198.51.100.20": {
        proxy: "no",
        type: "Residential",
        risk: 12
      }
    });

    expect(state.score).toBe(12);
    expect(state.label).toBe("正常");
    expect(state.signals.proxy).toBe(false);
  });

  it("labels risk thresholds", () => {
    expect(ipRiskLabel(null)).toBe("未知");
    expect(ipRiskLabel(24)).toBe("正常");
    expect(ipRiskLabel(25)).toBe("偏高");
    expect(ipRiskLabel(50)).toBe("高");
    expect(ipRiskLabel(75)).toBe("严重");
  });

  it("sanitizes API keys before storage", () => {
    expect(sanitizeProxycheckApiKey("  key-123  ")).toBe("key-123");
    expect(sanitizeProxycheckApiKey("")).toBeNull();
    expect(sanitizeProxycheckApiKey("x".repeat(513))).toBeNull();
  });

  it("creates a masked API key preview", () => {
    expect(maskProxycheckApiKey(undefined)).toBeNull();
    expect(maskProxycheckApiKey("abcd")).toBe("••••");
    expect(maskProxycheckApiKey("proxycheck-key-1234")).toBe(
      "••••••••••••••1234"
    );
  });
});
