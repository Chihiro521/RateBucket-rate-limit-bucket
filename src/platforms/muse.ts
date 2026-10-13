import { asRecord, getNumber, getString } from "../utils/safeJson";
import { formatUsageError, usageErrorFromBridge } from "./errors";
import { mergeUsageSnapshots } from "./merge";
import type { UsageEndpointFetcher, UsageMeter, UsageSnapshot, UsageSource } from "./types";

export const MUSE_ENDPOINT_KEY = "muse:subscription" as const;

type MuseSubscription = {
  tier?: { name?: string; tierId?: string };
  usage?: { state?: string; percentUsed?: number; resetsAt?: number };
  usageRowLabel?: string;
  topupBalance?: number;
  topupTotal?: number;
  topupRowLabel?: string;
  topupRowValueLabel?: string;
};

export type MuseSubscriptionResult =
  | { success: true; subscription: MuseSubscription }
  | { success: false; unauthorized: boolean; error: string };

// Project only quota fields out of the server action, including when the site
// requests agreement/billing data along with its usage reading.
export function parseMuseSubscriptionJson(value: unknown): MuseSubscriptionResult | null {
  const root = asRecord(value);
  if (!root || typeof root.success !== "boolean") return null;
  if (!root.success) {
    const recovery = asRecord(root.sessionRecovery);
    const unauthorized = root.unauthorized === true ||
      (recovery?.scope === "hatch" &&
        (recovery.reason === "authentication" || recovery.reason === "checkpoint"));
    return {
      success: false,
      unauthorized,
      error: unauthorized ? "请登录 Muse 后刷新额度" : "Muse 额度查询失败"
    };
  }
  const subscription = asRecord(root.subscription);
  if (!subscription) return null;
  const tier = asRecord(subscription.tier);
  const usage = asRecord(subscription.usage);
  return {
    success: true,
    subscription: {
      tier: tier ? {
        name: getString(tier, "name") ?? undefined,
        tierId: getString(tier, "tierId") ?? undefined
      } : undefined,
      usage: usage ? {
        state: getString(usage, "state") ?? undefined,
        percentUsed: getNumber(usage, "percentUsed") ?? undefined,
        resetsAt: getNumber(usage, "resetsAt") ?? undefined
      } : undefined,
      usageRowLabel: getString(subscription, "usageRowLabel") ?? undefined,
      topupBalance: getNumber(subscription, "topupBalance") ?? undefined,
      topupTotal: getNumber(subscription, "topupTotal") ?? undefined,
      topupRowLabel: getString(subscription, "topupRowLabel") ?? undefined,
      topupRowValueLabel: getString(subscription, "topupRowValueLabel") ?? undefined
    }
  };
}

export function parseMuseSubscriptionText(text: string): MuseSubscriptionResult | null {
  for (const line of text.split(/\r?\n/)) {
    // RSC model rows have a hexadecimal ID. Ignore imports, errors and other
    // records rather than interpreting the entire Flight stream as JSON.
    const match = /^[0-9a-f]+:(\{.*\})$/i.exec(line);
    if (!match) continue;
    try {
      const result = parseMuseSubscriptionJson(JSON.parse(match[1]));
      if (result) return result;
    } catch {
      // A later model row may contain the subscription result.
    }
  }
  return null;
}

export function normalizeMuseUsage(value: unknown, source: UsageSource = "api"): UsageMeter[] {
  const result = parseMuseSubscriptionJson(value);
  if (!result?.success) return [];
  const subscription = result.subscription;
  const meters: UsageMeter[] = [];
  const usage = subscription.usage;
  if (usage) {
    const metered = usage.state === "METERED" && typeof usage.percentUsed === "number";
    const unlimited = usage.state === "UNLIMITED";
    const usedPercent = metered ? Math.max(0, Math.min(100, usage.percentUsed!)) : undefined;
    meters.push({
      key: "muse:weekly",
      label: subscription.usageRowLabel || subscription.tier?.name || "Muse weekly",
      usedPercent,
      remainingPercent: usedPercent === undefined ? undefined : 100 - usedPercent,
      resetAt: metered && typeof usage.resetsAt === "number" && usage.resetsAt > 0
        ? usage.resetsAt * 1000 : undefined,
      windowSeconds: metered ? 7 * 24 * 60 * 60 : undefined,
      quotaState: !metered && !unlimited ? "unknown" : undefined,
      displayValue: unlimited ? "Unlimited" : undefined,
      metricKind: "quota",
      unit: "percent",
      source,
      confidence: metered || unlimited ? "high" : "low",
      rawKind: unlimited ? "muse.unlimited" : "muse.weekly"
    });
  }
  const balance = subscription.topupBalance;
  const total = subscription.topupTotal;
  const displayValue = subscription.topupRowValueLabel?.trim();
  if (typeof balance === "number" && typeof total === "number" && total > 0 && displayValue) {
    const usedPercent = Math.round(100 * (total - Math.min(Math.max(balance, 0), total)) / total);
    meters.push({
      key: "muse:topup",
      label: subscription.topupRowLabel || "Additional usage",
      displayValue,
      usedPercent,
      remainingPercent: 100 - usedPercent,
      metricKind: "balance",
      unit: "percent",
      source,
      confidence: "high",
      rawKind: "muse.topup"
    });
  }
  return meters;
}

export function museSnapshotFromResult(
  result: MuseSubscriptionResult | null,
  source: UsageSource,
  observedAt: number,
  requestStartedAt = observedAt
): UsageSnapshot {
  const meters = normalizeMuseUsage(result, source).map((meter) => ({ ...meter, observedAt, requestStartedAt }));
  const errorCode = result === null || (result.success && !meters.length) ? "PARSER_ERROR"
    : !result.success ? result.unauthorized ? "UNAUTHORIZED" : "UNKNOWN" : undefined;
  return {
    platform: "muse",
    meters,
    source: meters.length ? source : "unknown",
    updatedAt: observedAt,
    checkedAt: errorCode ? undefined : observedAt,
    status: errorCode ? "error" : meters.some((meter) => meter.quotaState === "unknown") ? "partial" : "ok",
    errorCode,
    errorMessage: errorCode ? result && !result.success ? result.error : "Muse 额度响应结构变化" : undefined,
    debug: { endpoint: MUSE_ENDPOINT_KEY, parser: "muse.subscription" }
  };
}

export async function fetchMuseUsage(fetcher: UsageEndpointFetcher): Promise<UsageSnapshot> {
  const response = await fetcher(MUSE_ENDPOINT_KEY);
  if (!response.ok) {
    const error = usageErrorFromBridge(response);
    return {
      platform: "muse", meters: [], source: "unknown", updatedAt: Date.now(), status: "error",
      errorCode: error.code,
      errorMessage: error.code === "UNAUTHORIZED" ? "请登录 Muse 后刷新额度"
        : formatUsageError(error, MUSE_ENDPOINT_KEY)
    };
  }
  return museSnapshotFromResult(
    typeof response.text === "string" ? parseMuseSubscriptionText(response.text) : parseMuseSubscriptionJson(response.json),
    "api", response.observedAt ?? Date.now(), response.requestStartedAt
  );
}

export function mergeMuseUsageSnapshots(previous: UsageSnapshot | null, incoming: UsageSnapshot, now = Date.now()): UsageSnapshot {
  const newestPreviousRequest = Math.max(0, ...(previous?.meters.map((meter) => meter.requestStartedAt ?? meter.observedAt ?? 0) ?? []));
  if (previous && incoming.meters.length && incoming.meters.every((meter) =>
    newestPreviousRequest > (meter.requestStartedAt ?? meter.observedAt ?? incoming.updatedAt))) {
    return previous!;
  }
  if (incoming.errorCode === "UNAUTHORIZED" || incoming.status !== "error") return incoming;
  const merged = mergeUsageSnapshots(previous, incoming, now);
  return {
    ...merged,
    source: merged.meters.length ? previous?.source ?? "unknown" : "unknown",
    updatedAt: previous?.updatedAt ?? incoming.updatedAt,
    checkedAt: previous?.checkedAt,
    errorCode: incoming.errorCode,
    errorMessage: incoming.errorMessage
  };
}
