import { normalizeClaudeUsage } from "./claude";
import {
  grokRateLimitContextFromJson,
  normalizeGrokRateLimit,
  rememberGrokRateLimitContext
} from "./grok";
import { normalizeChatGptIntercepted } from "./chatgpt";
import type {
  EndpointKey,
  PlatformId,
  UsageMeter,
  UsageRequestContext,
  UsageSnapshot
} from "./types";

export function normalizeInterceptedUsage(args: {
  platform: PlatformId;
  url: string;
  json: unknown;
  ts: number;
  endpointKey?: EndpointKey;
  usageContext?: UsageRequestContext;
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
  endpointKey?: EndpointKey;
  usageContext?: UsageRequestContext;
}): UsageMeter[] {
  if (args.platform === "grok") {
    const usageContext = args.usageContext ?? grokRateLimitContextFromJson(args.json);
    rememberGrokRateLimitContext(usageContext);
    return normalizeGrokRateLimit(args.json, {
      modelName: usageContext?.modelName,
      requestKind: usageContext?.requestKind,
      source: "intercepted"
    });
  }
  if (args.platform === "claude") {
    return normalizeClaudeUsage(args.json, "intercepted");
  }
  return normalizeChatGptIntercepted(args.url, args.json);
}
