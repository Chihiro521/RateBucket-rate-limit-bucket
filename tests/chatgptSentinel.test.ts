import { describe, expect, it } from "vitest";
import {
  chatRequirementsUrlKind,
  computeSentinelRisk,
  containsForbiddenSentinelKey,
  parsePowRisk,
  sanitizeSentinelResponse,
  toChatGPTSentinelState
} from "../src/platforms/chatgptSentinel";

describe("chatgpt sentinel", () => {
  it("computes Easy PoW risk from difficulty only", () => {
    const obs = {
      source: "chatgpt-sentinel" as const,
      ts: 1_777_714_508_000,
      urlKind: "prepare" as const,
      powRequired: true,
      powDifficulty: "061a80"
    };

    const pow = parsePowRisk(obs.powDifficulty);
    const sentinel = computeSentinelRisk(obs);

    expect(pow).toMatchObject({
      clean: "61a80",
      len: 5,
      decimal: 400000,
      level: "Easy",
      risk: 25
    });
    expect(sentinel.score).toBe(25);
    expect(sentinel.label).toBe("偏高");
  });

  it("computes Critical PoW risk", () => {
    const state = toChatGPTSentinelState({
      source: "chatgpt-sentinel",
      ts: 1,
      urlKind: "chat-requirements",
      powRequired: true,
      powDifficulty: "0000af"
    });

    expect(state.pow).toMatchObject({
      clean: "af",
      len: 2,
      level: "Critical",
      risk: 100
    });
    expect(state.sentinelRisk).toEqual({ score: 100, label: "严重" });
    expect(state.explanation).toBe("当前仅验证 PoW 难度，不判断模型 fallback。");
  });

  it("treats Very Easy PoW as normal", () => {
    const state = toChatGPTSentinelState({
      source: "chatgpt-sentinel",
      ts: 1,
      urlKind: "chat-requirements",
      powRequired: true,
      powDifficulty: "123456"
    });

    expect(state.pow).toMatchObject({
      len: 6,
      level: "Very Easy",
      risk: 0
    });
    expect(state.sentinelRisk.score).toBe(0);
  });

  it("sanitizes known response shapes and ignores non-PoW gates", () => {
    const observation = sanitizeSentinelResponse(
      {
        requirements: {
          persona: "chatgpt-paid",
          token: "secret-token-value",
          prepare_token: "secret-prepare-token",
          expire_after: 540,
          expire_at: 1_777_714_508,
          proofofwork: {
            required: true,
            difficulty: "061a80",
            seed: "secret-seed"
          },
          turnstile: {
            required: true,
            dx: "secret-dx"
          },
          so: {
            required: true,
            collector_dx: "secret-collector"
          }
        }
      },
      "https://chatgpt.com/backend-api/sentinel/chat-requirements/prepare",
      123
    );

    expect(observation).toEqual({
      source: "chatgpt-sentinel",
      ts: 123,
      urlKind: "prepare",
      powRequired: true,
      powDifficulty: "061a80"
    });
    const serialized = JSON.stringify(observation);
    expect(serialized).not.toContain("chatgpt-paid");
    expect(serialized).not.toContain("secret-token-value");
    expect(serialized).not.toContain("secret-prepare-token");
    expect(serialized).not.toContain("secret-seed");
    expect(serialized).not.toContain("secret-dx");
    expect(serialized).not.toContain("secret-collector");
  });

  it("matches only supported chat-requirements URLs and excludes finalize", () => {
    expect(
      chatRequirementsUrlKind(
        "https://chatgpt.com/backend-api/sentinel/chat-requirements"
      )
    ).toBe("chat-requirements");
    expect(
      chatRequirementsUrlKind(
        "https://chatgpt.com/backend-anon/sentinel/chat-requirements/prepare?x=1"
      )
    ).toBe("prepare");
    expect(
      chatRequirementsUrlKind(
        "https://chatgpt.com/backend-api/sentinel/chat-requirements/finalize"
      )
    ).toBeNull();
  });

  it("detects forbidden raw sentinel keys before storage", () => {
    expect(
      containsForbiddenSentinelKey({
        turnstile: {
          dx: "secret"
        }
      })
    ).toBe(true);
    expect(
      containsForbiddenSentinelKey({
        source: "chatgpt-sentinel",
        powRequired: true,
        powDifficulty: "061a80"
      })
    ).toBe(false);
  });
});
