import { describe, expect, it } from "vitest";
import {
  normalizeChatGptAccountsCheck,
  fetchChatGptUsage,
  normalizeChatGptCodexSettingsUsage,
  normalizeChatGptConversationInit,
  normalizeChatGptWhamUsage
} from "../src/platforms/chatgpt";
import type { BridgeResponse, UsageEndpointFetcher } from "../src/platforms/types";

describe("chatgpt normalizer", () => {
  it("normalizes limits_progress for deep research and image generation", () => {
    const normalized = normalizeChatGptConversationInit({
      default_model_slug: "gpt-5",
      limits_progress: [
        {
          feature_name: "deep_research",
          remaining: 4,
          reset_after: "2026-05-01T00:00:00Z"
        },
        {
          feature_name: "image_gen",
          remaining: 10,
          reset_after: 3600
        },
        {
          feature_name: "computer_use",
          remaining: 2,
          reset_after: "2026-05-02T00:00:00Z"
        }
      ]
    });

    expect(normalized.defaultModelSlug).toBe("gpt-5");
    expect(normalized.meters.map((meter) => meter.label)).toEqual([
      "Deep Research",
      "Image Generation",
      "Computer Use"
    ]);
    expect(normalized.meters[0].remaining).toBe(4);
    expect(normalized.meters[0].resetAt).toBe("2026-05-01T00:00:00Z");
    expect(normalized.meters[1].resetAt).toBeNull();
    expect(normalized.meters[1].resetAfterSeconds).toBe(3600);
    expect(normalized.meters[2].resetAt).toBe("2026-05-02T00:00:00Z");
  });

  it("treats numeric limits_progress reset_after strings as relative seconds", () => {
    const normalized = normalizeChatGptConversationInit({
      limits_progress: [
        {
          feature_name: "file_upload",
          remaining: 3,
          reset_after: "86399"
        }
      ]
    });

    expect(normalized.meters[0]).toMatchObject({
      key: "limits_progress:file_upload",
      remaining: 3,
      resetAt: null,
      resetAfterSeconds: 86399
    });
  });

  it("normalizes object blocked_features as zero remaining feature meters", () => {
    const normalized = normalizeChatGptConversationInit({
      blocked_features: [
        {
          name: "deep_research",
          limit: 0,
          resets_after: "2026-08-02T09:08:12.525030+00:00"
        },
        {
          name: "image_gen",
          limit: 0,
          resets_after: "2026-08-03T09:08:12.525030+00:00"
        },
        {
          name: "computer_control",
          limit: 0,
          resets_after: "2026-08-04T09:08:12.525030+00:00"
        }
      ]
    });

    expect(normalized.blockedFeatures).toEqual([
      "deep_research",
      "image_gen",
      "computer_control"
    ]);
    expect(normalized.meters[0]).toMatchObject({
      key: "limits_progress:deep_research",
      label: "Deep Research",
      remaining: 0,
      total: null,
      resetAt: "2026-08-02T09:08:12.525030+00:00",
      rawKind: "blocked_features"
    });
    expect(normalized.meters[1]).toMatchObject({
      key: "limits_progress:image_gen",
      label: "Image Generation",
      remaining: 0,
      total: null,
      resetAt: "2026-08-03T09:08:12.525030+00:00",
      rawKind: "blocked_features"
    });
    expect(normalized.meters[2]).toMatchObject({
      key: "limits_progress:computer_control",
      label: "Computer Control",
      remaining: 0,
      total: null,
      resetAt: "2026-08-04T09:08:12.525030+00:00",
      rawKind: "blocked_features"
    });
  });

  it("normalizes wham primary, secondary, and code review windows", () => {
    const meters = normalizeChatGptWhamUsage({
      plan_type: "unknown_future_plan",
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: {
          used_percent: 0.4,
          reset_at: 1_775_000_000,
          limit_window_seconds: 10800
        },
        secondary_window: {
          used_percent: 85,
          reset_at: 1_776_000_000,
          limit_window_seconds: 604800
        }
      },
      code_review_rate_limit: {
        primary_window: {
          used_percent: 12,
          reset_at: 1_775_001_000
        }
      }
    });

    expect(meters.map((meter) => meter.label)).toEqual([
      "Primary window",
      "Weekly window",
      "Code Review"
    ]);
    expect(meters[0].usedPercent).toBe(40);
    expect(meters[0].remainingPercent).toBe(60);
    expect(meters[1].usedPercent).toBe(85);
    expect(meters[1].remainingPercent).toBe(15);
  });

  it("normalizes additional ChatGPT usage windows from wham usage", () => {
    const meters = normalizeChatGptWhamUsage({
      rate_limit: {
        primary_window: {
          used_percent: 0.01,
          reset_at: 1_775_000_000
        }
      },
      model_rate_limits: [
        {
          label: "GPT-5.3-Codex-Spark 5 小时使用限额",
          remaining_percent: 100,
          reset_at: 1_775_001_000
        },
        {
          title: "GPT-5.3-Codex-Spark 每周使用限额",
          percent_remaining: 0.98,
          reset_at: 1_775_002_000
        }
      ]
    });

    expect(meters.map((meter) => meter.label)).toContain(
      "GPT-5.3-Codex-Spark 5 小时使用限额"
    );
    expect(meters.map((meter) => meter.label)).toContain(
      "GPT-5.3-Codex-Spark 每周使用限额"
    );
    expect(
      meters.find((meter) => meter.label.includes("5 小时"))?.remainingPercent
    ).toBe(100);
    expect(
      meters.find((meter) => meter.label.includes("每周"))?.remainingPercent
    ).toBe(98);
  });

  it("labels additional wham rate limits as GPT-5.3 Codex Spark windows", () => {
    const meters = normalizeChatGptWhamUsage({
      additional_rate_limits: {
        primary_window: {
          used_percent: 0.28,
          reset_at: 1_775_001_000,
          limit_window_seconds: 7200
        },
        secondary_window: {
          used_percent: 1,
          reset_at: 1_775_604_800,
          limit_window_seconds: 604800
        }
      }
    });

    expect(meters).toHaveLength(2);
    expect(meters[0]).toMatchObject({
      key: "codex:root.additional_rate_limits.primary_window",
      label: "GPT-5.3-Codex-Spark Primary window",
      rawKind: "codex.spark.rate_limit",
      usedPercent: 28,
      remainingPercent: 72
    });
    expect(meters[1]).toMatchObject({
      key: "codex:root.additional_rate_limits.secondary_window",
      label: "GPT-5.3-Codex-Spark Weekly window",
      rawKind: "codex.spark.rate_limit",
      usedPercent: 100,
      remainingPercent: 0
    });
  });

  it("normalizes codex-named usage data from wham usage", () => {
    const meters = normalizeChatGptWhamUsage({
      codex_usage: {
        remaining: 7,
        limit: 20,
        reset_at: 1_775_000_000
      },
      code_review_rate_limit: {
        primary_window: {
          used_percent: 12,
          reset_at: 1_775_001_000
        }
      }
    });

    const codexMeter = meters.find(
      (meter) => meter.rawKind === "codex.settings.usage"
    );
    expect(
      meters.filter((meter) => meter.rawKind === "codex.settings.usage")
    ).toHaveLength(1);
    expect(meters.some((meter) => meter.key === "wham:root.codex_usage")).toBe(
      false
    );
    expect(codexMeter).toMatchObject({
      label: "Codex usage",
      remaining: 7,
      total: 20,
      used: 13
    });
    expect(meters.some((meter) => meter.key.includes("code_review.codex"))).toBe(
      false
    );
  });

  it("normalizes ChatGPT subscription expiry from accounts check", () => {
    const meters = normalizeChatGptAccountsCheck({
      accounts: {
        default: {
          entitlement: {
            has_active_subscription: true,
            subscription_plan: "chatgptprolite",
            expires_at: "2026-08-04T11:38:16+00:00",
            renews_at: "2026-08-04T05:38:16+00:00"
          }
        }
      }
    });

    expect(meters).toHaveLength(1);
    expect(meters[0]).toMatchObject({
      key: "chatgpt:subscription",
      label: "ChatGPT subscription",
      modelName: "chatgptprolite",
      requestKind: "expires",
      resetAt: "2026-08-04T11:38:16+00:00",
      rawKind: "chatgpt.subscription"
    });
  });

  it("normalizes credits", () => {
    const meters = normalizeChatGptWhamUsage({
      credits: {
        has_credits: true,
        unlimited: true,
        balance: 123
      }
    });

    expect(meters[0]).toMatchObject({
      label: "Credits (unlimited)",
      remaining: 123
    });
  });

  it("normalizes codex settings usage remaining and total fields", () => {
    const meters = normalizeChatGptCodexSettingsUsage({
      remaining: 42,
      total: 100,
      reset_at: 1_775_000_000
    });

    expect(meters).toHaveLength(1);
    expect(meters[0]).toMatchObject({
      label: "Codex usage",
      remaining: 42,
      total: 100,
      used: 58,
      rawKind: "codex.settings.usage"
    });
  });

  it("normalizes nested codex usage fields", () => {
    const meters = normalizeChatGptCodexSettingsUsage({
      usage: {
        codex: {
          label: "weekly",
          used_percent: 0.75,
          reset_after_seconds: 3600
        }
      }
    });

    expect(meters).toHaveLength(1);
    expect(meters[0]).toMatchObject({
      label: "Codex Weekly",
      usedPercent: 75,
      remainingPercent: 25,
      resetAfterSeconds: 3600
    });
  });

  it("normalizes deeper codex settings windows with remaining percentages", () => {
    const meters = normalizeChatGptCodexSettingsUsage({
      data: {
        limits: {
          windows: [
            {
              title: "5 小时使用限额",
              remaining_percentage: 99,
              reset_at: "2026-05-01T20:28:00Z"
            },
            {
              model_name: "GPT-5.3-Codex-Spark",
              window_name: "weekly",
              remainingPercent: 0.01,
              reset_at: "2026-05-07T16:22:00Z"
            }
          ]
        }
      }
    });

    expect(meters).toHaveLength(2);
    expect(meters[0]).toMatchObject({
      label: "5 小时使用限额",
      remainingPercent: 99
    });
    expect(meters[1]).toMatchObject({
      label: "GPT-5.3-Codex-Spark Weekly 使用限额",
      remainingPercent: 1
    });
  });

  it("reports blocked_features as partial in adapter output", async () => {
    const okConversation: BridgeResponse = {
      source: "ai-usage-floating-monitor",
      direction: "main-to-content",
      requestId: "1",
      ok: true,
      platform: "chatgpt",
      endpointKey: "chatgpt:conversationInit",
      json: {
        limits_progress: [{ feature_name: "deep_research", remaining: 1 }],
        blocked_features: ["image_gen"]
      }
    };
    const okWham: BridgeResponse = {
      source: "ai-usage-floating-monitor",
      direction: "main-to-content",
      requestId: "2",
      ok: true,
      platform: "chatgpt",
      endpointKey: "chatgpt:whamUsage",
      json: {
        rate_limit: {
          primary_window: { used_percent: 10 }
        }
      }
    };
    const failTasks: BridgeResponse = {
      source: "ai-usage-floating-monitor",
      direction: "main-to-content",
      requestId: "3",
      ok: false,
      platform: "chatgpt",
      endpointKey: "chatgpt:whamTasksRateLimit",
      error: { status: 404, message: "not found" }
    };
    const okCodex: BridgeResponse = {
      source: "ai-usage-floating-monitor",
      direction: "main-to-content",
      requestId: "4",
      ok: true,
      platform: "chatgpt",
      endpointKey: "chatgpt:codexSettingsUsage",
      json: {
        remaining: 2,
        total: 5
      }
    };
    const fetcher: UsageEndpointFetcher = async (endpointKey) => {
      if (endpointKey === "chatgpt:conversationInit") {
        return okConversation;
      }
      if (endpointKey === "chatgpt:whamUsage") {
        return okWham;
      }
      if (endpointKey === "chatgpt:codexSettingsUsage") {
        return okCodex;
      }
      return failTasks;
    };

    const snapshot = await fetchChatGptUsage(fetcher);

    expect(snapshot.status).toBe("partial");
    expect(snapshot.errorMessage).toBe("部分功能被限制");
    expect(snapshot.meters.some((meter) => meter.rawKind === "codex.settings.usage")).toBe(
      true
    );
  });

  it("does not actively poll accounts check during refresh", async () => {
    const requested: string[] = [];
    const fetcher: UsageEndpointFetcher = async (endpointKey) => {
      requested.push(endpointKey);
      return {
        source: "ai-usage-floating-monitor",
        direction: "main-to-content",
        requestId: endpointKey,
        ok: endpointKey !== "chatgpt:whamTasksRateLimit",
        platform: "chatgpt",
        endpointKey,
        json:
          endpointKey === "chatgpt:conversationInit"
            ? { limits_progress: [{ feature_name: "file_upload", remaining: 1 }] }
            : {}
      };
    };

    await fetchChatGptUsage(fetcher);

    expect(requested).not.toContain("chatgpt:accountsCheck");
  });

  it("does not surface optional wham failures as red errors when other meters exist", async () => {
    const okConversation: BridgeResponse = {
      source: "ai-usage-floating-monitor",
      direction: "main-to-content",
      requestId: "1",
      ok: true,
      platform: "chatgpt",
      endpointKey: "chatgpt:conversationInit",
      json: {
        limits_progress: [{ feature_name: "file_upload", remaining: 3 }]
      }
    };
    const unauthorizedWham: BridgeResponse = {
      source: "ai-usage-floating-monitor",
      direction: "main-to-content",
      requestId: "2",
      ok: false,
      platform: "chatgpt",
      endpointKey: "chatgpt:whamUsage",
      error: { status: 401, message: "Unauthorized" }
    };
    const notFound: BridgeResponse = {
      source: "ai-usage-floating-monitor",
      direction: "main-to-content",
      requestId: "3",
      ok: false,
      platform: "chatgpt",
      endpointKey: "chatgpt:whamTasksRateLimit",
      error: { status: 404, message: "not found" }
    };
    const fetcher: UsageEndpointFetcher = async (endpointKey) => {
      if (endpointKey === "chatgpt:conversationInit") {
        return okConversation;
      }
      if (endpointKey === "chatgpt:whamUsage") {
        return unauthorizedWham;
      }
      return notFound;
    };

    const snapshot = await fetchChatGptUsage(fetcher);

    expect(snapshot.status).toBe("partial");
    expect(snapshot.meters).toHaveLength(1);
    expect(snapshot.errorMessage).toBeUndefined();
  });

  it("tolerates missing fields", () => {
    expect(normalizeChatGptConversationInit({}).meters).toEqual([]);
    expect(normalizeChatGptWhamUsage({ rate_limit: {} })).toEqual([]);
  });
});
