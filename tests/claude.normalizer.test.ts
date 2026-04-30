import { describe, expect, it } from "vitest";
import { extractClaudeOrgId, normalizeClaudeUsage } from "../src/platforms/claude";

describe("claude normalizer", () => {
  it("extracts org id from array and object responses", () => {
    expect(extractClaudeOrgId([{ uuid: "org-a" }])).toBe("org-a");
    expect(extractClaudeOrgId({ organizations: [{ id: "org-b" }] })).toBe("org-b");
  });

  it("normalizes five_hour and seven_day meters", () => {
    const meters = normalizeClaudeUsage({
      five_hour: { utilization: 0.25, resets_at: "2026-04-30T10:00:00Z" },
      seven_day: { utilization: 80, resets_at: "2026-05-01T10:00:00Z" }
    });

    expect(meters).toHaveLength(2);
    expect(meters[0]).toMatchObject({
      label: "5h",
      usedPercent: 25,
      confidence: "high"
    });
    expect(meters[1]).toMatchObject({
      label: "7d all models",
      usedPercent: 80
    });
  });

  it("normalizes model-specific and unknown utilization keys", () => {
    const meters = normalizeClaudeUsage({
      seven_day_sonnet: { utilization: 0.5 },
      custom_window: { used_percentage: 33 }
    });

    expect(meters.map((meter) => meter.label)).toEqual([
      "7d Sonnet",
      "Custom Window"
    ]);
    expect(meters[0].confidence).toBe("medium");
  });

  it("normalizes extra_usage and tolerates null fields", () => {
    const meters = normalizeClaudeUsage({
      extra_usage: {
        is_enabled: true,
        monthly_limit: 100,
        used_credits: 35,
        utilization: 0.35,
        currency: "USD"
      },
      seven_day_opus: {
        utilization: null,
        resets_at: null
      }
    });

    expect(meters[0]).toMatchObject({
      label: "Extra Usage",
      remaining: 65,
      total: 100,
      used: 35,
      usedPercent: 35
    });
    expect(meters).toHaveLength(1);
  });
});
