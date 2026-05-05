import { describe, expect, it } from "vitest";
import { normalizeKimiUsage } from "../src/platforms/kimi";

const SAMPLE_RESPONSE = {
  subscription: {
    subscriptionId: "19df5d6b-3db2-8fa9-8000-00000904d9e4",
    goods: {
      id: "b2c3d4e5-f6a7-8901-bcde-f23456789016",
      title: "Allegretto",
      durationDays: 30,
      useRegion: "REGION_CN",
      createTime: "2025-09-03T09:26:48.609Z",
      updateTime: "2025-09-03T09:26:48.609Z",
      membershipLevel: "LEVEL_INTERMEDIATE",
      amounts: [
        {
          currency: "CNY",
          priceInCents: "19900"
        }
      ],
      billingCycle: {
        duration: 1,
        timeUnit: "TIME_UNIT_MONTH"
      }
    },
    subscriptionTime: "2026-05-05T01:53:01.915886Z",
    currentStartTime: "2026-05-05T01:53:01.925466Z",
    currentEndTime: "2026-06-05T00:00:00Z",
    nextBillingTime: "2026-06-04T01:53:01.925466Z",
    status: "SUBSCRIPTION_STATUS_CANCEL",
    paymentChannel: "PAYMENT_CHANNEL_ALIPAY",
    type: "TYPE_PURCHASE",
    active: true
  },
  balances: [
    {
      id: "19df5d70-6d92-8302-8000-0000ecec294d",
      feature: "FEATURE_OMNI",
      type: "SUBSCRIPTION",
      unit: "UNIT_CREDIT",
      amountUsedRatio: 0.0519,
      expireTime: "2026-06-05T00:00:00Z"
    }
  ],
  subscribed: true
};

describe("normalizeKimiUsage", () => {
  it("parses balances from subscription response", () => {
    const meters = normalizeKimiUsage(SAMPLE_RESPONSE, "intercepted");
    expect(meters).toHaveLength(1);

    const meter = meters[0];
    expect(meter.key).toBe("omni");
    expect(meter.label).toBe("Allegretto");
    expect(meter.usedPercent).toBeCloseTo(5.19, 2);
    expect(meter.remainingPercent).toBeCloseTo(94.81, 2);
    expect(meter.resetAt).toBe(new Date("2026-06-05T00:00:00Z").getTime());
    expect(meter.source).toBe("intercepted");
    expect(meter.confidence).toBe("high");
    expect(meter.rawKind).toBe("FEATURE_OMNI");
  });

  it("returns empty array for invalid json", () => {
    const meters = normalizeKimiUsage(null, "api");
    expect(meters).toHaveLength(0);
  });

  it("returns empty array when balances is missing", () => {
    const meters = normalizeKimiUsage({ subscription: {} }, "api");
    expect(meters).toHaveLength(0);
  });

  it("uses feature name as fallback label when goods title is missing", () => {
    const response = {
      balances: [
        {
          feature: "FEATURE_OMNI",
          amountUsedRatio: 0.1,
          expireTime: "2026-06-05T00:00:00Z"
        }
      ]
    };
    const meters = normalizeKimiUsage(response, "api");
    expect(meters[0].label).toBe("Credit");
  });
});
