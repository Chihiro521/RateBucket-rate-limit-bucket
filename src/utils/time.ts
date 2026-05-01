import type { UsageMeter } from "../platforms/types";

export function formatAge(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 5) {
    return "刚刚";
  }
  if (seconds < 60) {
    return `${seconds}秒前`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}小时前`;
  }
  return `${Math.floor(hours / 24)}天前`;
}

export function resolveResetMs(meter: UsageMeter, now = Date.now()): number | null {
  if (typeof meter.resetAfterSeconds === "number") {
    return now + meter.resetAfterSeconds * 1000;
  }
  if (typeof meter.resetAt === "number") {
    if (meter.resetAt > 10_000_000_000) {
      return meter.resetAt;
    }
    if (meter.resetAt > 1_000_000_000) {
      return meter.resetAt * 1000;
    }
    if (meter.resetAt > 0) {
      return now + meter.resetAt * 1000;
    }
  }
  if (typeof meter.resetAt === "string") {
    const parsed = Date.parse(meter.resetAt);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function formatReset(meter: UsageMeter, now = Date.now()): string {
  const resetMs = resolveResetMs(meter, now);
  if (resetMs === null) {
    return "";
  }
  const seconds = Math.max(0, Math.floor((resetMs - now) / 1000));
  if (seconds < 60) {
    return `${seconds}秒`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}分钟`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}小时`;
  }
  return `${Math.floor(hours / 24)}天`;
}
