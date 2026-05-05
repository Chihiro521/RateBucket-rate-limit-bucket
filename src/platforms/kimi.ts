import type {
  UsageMeter,
  UsageSnapshot,
  UsageSource
} from "./types";
import { asArray, asRecord, getNumber, getRecord, getString } from "../utils/safeJson";

const FEATURE_LABELS: Record<string, string> = {
  FEATURE_OMNI: "Credit"
};

function parseDateToTimestamp(value: unknown): number | null {
  const str = typeof value === "string" ? value : null;
  if (!str) {
    return null;
  }
  const date = new Date(str);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.getTime();
}

export function normalizeKimiUsage(
  json: unknown,
  source: UsageSource = "api"
): UsageMeter[] {
  const root = asRecord(json);
  if (!root) {
    return [];
  }

  const balances = asArray(root.balances);
  const subscription = asRecord(root.subscription);
  const meters: UsageMeter[] = [];

  let planTitle: string | null = null;
  if (subscription) {
    const goods = getRecord(subscription, "goods");
    planTitle = goods ? getString(goods, "title") : null;
  }

  for (const item of balances) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    const feature = getString(record, "feature") ?? "unknown";
    const usedRatio = getNumber(record, "amountUsedRatio");
    const expireTime = parseDateToTimestamp(record.expireTime);

    if (usedRatio === null) {
      continue;
    }

    const usedPercent = usedRatio >= 0 && usedRatio <= 1 ? usedRatio * 100 : usedRatio;
    const remainingPercent = Math.max(0, Math.min(100, 100 - usedPercent));

    meters.push({
      key: feature.toLowerCase().replace(/^feature_/, ""),
      label: planTitle ?? FEATURE_LABELS[feature] ?? feature,
      usedPercent,
      remainingPercent,
      resetAt: expireTime,
      source,
      confidence: "high",
      rawKind: feature
    });
  }

  return meters;
}

export async function fetchKimiUsage(): Promise<UsageSnapshot> {
  // Kimi relies entirely on intercepted responses because its
  // MembershipService endpoint requires a Bearer Authorization header
  // that we cannot reliably construct from the content script world.
  return {
    platform: "kimi",
    meters: [],
    source: "unknown",
    updatedAt: Date.now(),
    status: "unknown"
  };
}
