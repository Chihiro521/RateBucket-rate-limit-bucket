import { normalizeClaudeUsage } from "./claude";
import { normalizeGrokCreditsConfig } from "./grok";
import { normalizeChatGptIntercepted } from "./chatgpt";
import { normalizeGeminiUsageText } from "./gemini";
import { normalizeKimiUsage } from "./kimi";
import { normalizePerplexityRateLimit } from "./perplexity";
import type {
  EndpointKey,
  PlatformId,
  UsageMeter,
  UsageSnapshot
} from "./types";

export function normalizeInterceptedUsage(args: {
  platform: PlatformId;
  url: string;
  json: unknown;
  text?: string;
  ts: number;
  endpointKey?: EndpointKey;
}): UsageSnapshot {
  const meters = normalizeInterceptedMeters(args);
  return {
    platform: args.platform,
    meters,
    source: meters.length > 0 ? "intercepted" : "unknown",
    updatedAt: args.ts,
    status: meters.length > 0 ? "ok" : "unknown",
    debug: {
      endpoint: args.url,
      parser: `${args.platform}.intercepted`
    }
  };
}

function normalizeInterceptedMeters(args: {
  platform: PlatformId;
  url: string;
  json: unknown;
  text?: string;
  endpointKey?: EndpointKey;
}): UsageMeter[] {
  if (args.platform === "grok") {
    return normalizeGrokCreditsConfig(args.text, { source: "intercepted" });
  }
  if (args.platform === "claude") {
    return normalizeClaudeUsage(args.json, "intercepted");
  }
  if (args.platform === "kimi") {
    return normalizeKimiUsage(args.json, "intercepted");
  }
  if (args.platform === "gemini") {
    return typeof args.text === "string"
      ? normalizeGeminiUsageText(args.text, "intercepted").meters
      : [];
  }
  if (args.platform === "perplexity") {
    return normalizePerplexityRateLimit(args.json, "intercepted");
  }
  return normalizeChatGptIntercepted(args.url, args.json);
}
