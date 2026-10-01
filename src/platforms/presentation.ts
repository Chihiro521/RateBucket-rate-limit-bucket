import type { UsageMeter } from "./types";

export const STALE_METER_MS = 2 * 60_000;

// App-sharing sublimits are not additional ordinary ChatGPT plan windows.
export function isChatPassPath(path: string): boolean {
  return path.split(/[.:]/).some((part) =>
    part.replaceAll("_", "").toLowerCase().startsWith("chatpass"));
}

export function hasMeaningfulValue(meter: UsageMeter): boolean {
  return meter.quotaState === "blocked" || meter.quotaState === "unknown" || meter.metricKind === "subscription" ||
    meter.rawKind === "chatgpt.subscription" ||
    [meter.remaining, meter.total, meter.used, meter.remainingPercent, meter.usedPercent]
      .some((value) => typeof value === "number" && Number.isFinite(value)) ||
    meter.label === "Credits (unlimited)";
}

export function isAlertMeter(meter: UsageMeter): boolean {
  if (meter.metricKind === "balance" || meter.metricKind === "subscription" ||
      meter.rawKind === "credits" || meter.rawKind === "chatgpt.subscription" ||
      meter.source === "estimate") {
    return false;
  }
  if (meter.quotaState === "blocked") return true;
  if (meter.quotaState === "unknown") return false;
  return (typeof meter.remaining === "number" && meter.remaining <= 0) ||
    (typeof meter.remainingPercent === "number" && meter.remainingPercent <= 5) ||
    (typeof meter.usedPercent === "number" && meter.usedPercent >= 95);
}

export function meterProgress(meter: UsageMeter): number | null {
  if (meter.metricKind === "balance" || meter.metricKind === "subscription" ||
      meter.rawKind === "credits" || meter.rawKind === "chatgpt.subscription") return null;
  const clamp = (value: number): number => Math.max(0, Math.min(100, value));
  if (typeof meter.remainingPercent === "number") return clamp(meter.remainingPercent);
  if (typeof meter.usedPercent === "number") return clamp(meter.usedPercent);
  if (typeof meter.total === "number" && meter.total > 0) {
    if (typeof meter.used === "number") return clamp(meter.used / meter.total * 100);
    if (typeof meter.remaining === "number") return clamp((meter.total - meter.remaining) / meter.total * 100);
  }
  return null;
}

export function chatGptPrimaryMeter(meters: UsageMeter[]): UsageMeter | undefined {
  const quotas = meters.filter((meter) => hasMeaningfulValue(meter) &&
    !isChatPassPath(meter.key) &&
    meter.metricKind !== "balance" && meter.metricKind !== "subscription" &&
    meter.unit !== "bytes" && meter.rawKind !== "credits" &&
    meter.rawKind !== "chatgpt.subscription" && meter.source !== "estimate");
  return quotas.find((meter) => meter.quotaState === "blocked") ??
    quotas.find((meter) => meter.key === "wham:primary_window") ??
    quotas.find((meter) => meter.key === "wham:secondary_window") ??
    quotas.find((meter) => meter.quotaState !== "unknown") ?? quotas[0];
}
