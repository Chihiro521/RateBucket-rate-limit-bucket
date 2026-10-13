import type { PlatformId, UsageMeter, UsageSnapshot } from "../src/platforms/types";
import type { CopyKey, SiteLanguage } from "./copy";

export const platforms: Record<PlatformId, { name: string; domain: string; description: CopyKey }> = {
  chatgpt: { name: "ChatGPT", domain: "chatgpt.com", description: "platformChatgpt" },
  claude: { name: "Claude", domain: "claude.ai", description: "platformClaude" },
  grok: { name: "Grok", domain: "grok.com", description: "platformGrok" },
  gemini: { name: "Gemini", domain: "gemini.google.com", description: "platformGemini" },
  kimi: { name: "Kimi", domain: "kimi.com", description: "platformKimi" },
  perplexity: { name: "Perplexity", domain: "perplexity.ai", description: "platformPerplexity" },
  muse: { name: "Muse", domain: "muse.ai", description: "platformMuse" }
};

export function isPlatform(value: unknown): value is PlatformId {
  return typeof value === "string" && Object.hasOwn(platforms, value);
}

export function demoSnapshot(platform: PlatformId, language: SiteLanguage, refreshed = false, now = Date.now()): UsageSnapshot {
  const base = { source: "api" as const, confidence: "high" as const, observedAt: now };
  const reset = (seconds: number): number => now + seconds * 1000;
  const percent = (key: string, label: string, used: number, seconds: number, extra: Partial<UsageMeter> = {}): UsageMeter => ({
    ...base, key, label, usedPercent: used, remainingPercent: 100 - used,
    resetAt: reset(seconds), unit: "percent", metricKind: "quota", ...extra
  });
  const count = (key: string, label: string, remaining: number): UsageMeter => ({ ...base, key, label, remaining, unit: "count" });
  let meters: UsageMeter[];
  switch (platform) {
    case "chatgpt": meters = [
      { ...base, key: "chatgpt:subscription", label: "ChatGPT subscription", metricKind: "subscription", rawKind: "chatgpt.subscription", resetAt: reset(15 * 86_400 + 5 * 3600) },
      percent("wham:primary_window", "Primary window", refreshed ? 31 : 28, 9360, { windowSeconds: 18_000 }),
      percent("wham:secondary_window", "Secondary window", 42, 3 * 86_400, { windowSeconds: 604_800 }),
      count("limits_progress:deep_research", "Deep Research", refreshed ? 11 : 12),
      { ...base, key: "chatgpt:libraryStorage", label: "Library storage", remaining: 7.6 * 2 ** 30, total: 10 * 2 ** 30, used: 2.4 * 2 ** 30, usedPercent: 24, metricKind: "quota", rawKind: "chatgpt.library_storage", unit: "bytes" }
    ]; break;
    case "claude": meters = [
      percent("five_hour", "5h", refreshed ? 38 : 35, 9360, { windowSeconds: 18_000 }),
      percent("seven_day", "7d all models", 58, 3 * 86_400, { windowSeconds: 604_800 })
    ]; break;
    case "grok": meters = [
      percent("grok:weekly:total", "Weekly Grok limit", refreshed ? 40 : 37, 3 * 86_400, { rawKind: "grokCreditsConfig:total" }),
      percent("grok:weekly:imagine", "Imagine", refreshed ? 22 : 19, 3 * 86_400, { rawKind: "grokCreditsConfig:product:5" }),
      percent("grok:weekly:chat", "Chat", 12, 3 * 86_400, { rawKind: "grokCreditsConfig:product:4" }),
      percent("grok:weekly:grok-build", "Grok Build", 4, 3 * 86_400, { rawKind: "grokCreditsConfig:product:6" }),
      percent("grok:weekly:api", "API", 2, 3 * 86_400, { rawKind: "grokCreditsConfig:product:1" })
    ]; break;
    case "gemini": meters = [
      percent("gemini:5h", "Gemini 5h", refreshed ? 29 : 26, 7800, { windowSeconds: 18_000, remaining: refreshed ? 426 : 444, total: 600, rawKind: "type:1" }),
      percent("gemini:weekly", "Gemini weekly", 18, 4 * 86_400, { windowSeconds: 604_800, remaining: 9840, total: 12000, rawKind: "type:2" })
    ]; break;
    case "kimi": meters = [percent("omni", "Allegretto", refreshed ? 19 : 16, 19 * 86_400, { rawKind: "FEATURE_OMNI" })]; break;
    case "perplexity": meters = [
      count("perplexity:pro", "Pro", refreshed ? 238 : 240),
      count("perplexity:research", "Deep Research", 12),
      count("perplexity:labs", "Labs", 8)
    ]; break;
    case "muse": meters = [
      percent("muse:weekly", "Muse weekly", refreshed ? 48 : 45, 3 * 86_400, { rawKind: "muse.weekly", windowSeconds: 604_800 }),
      { ...base, key: "muse:topup", label: "Additional usage", metricKind: "balance", unit: "percent", usedPercent: 0, remainingPercent: 100,
        rawKind: "muse.topup", displayValue: language === "zh-CN" ? "已使用 0%（剩余 10 亿个词元）" : "0% used (1B tokens remaining)" }
    ]; break;
  }
  return { platform, meters, source: "api", status: "ok", updatedAt: now, checkedAt: now };
}
