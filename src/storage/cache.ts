import type { PlatformId, UsageSnapshot } from "../platforms/types";

export const CACHE_TTL_MS = 60_000;
export const MIN_REFRESH_INTERVAL_MS = 30_000;
export const FAILED_BACKOFF_STEPS_MS = [60_000, 120_000, 300_000] as const;

export type EstimateState = {
  sentCount: number;
  firstSentAt: number;
  lastSentAt: number;
};

function snapshotKey(platform: PlatformId): string {
  return `aiUsage:${platform}:snapshot`;
}

function lastRefreshKey(platform: PlatformId): string {
  return `aiUsage:${platform}:lastRefreshAt`;
}

function backoffKey(platform: PlatformId): string {
  return `aiUsage:${platform}:backoffUntil`;
}

function failureCountKey(platform: PlatformId): string {
  return `aiUsage:${platform}:failureCount`;
}

function estimateKey(platform: PlatformId): string {
  return `aiUsage:${platform}:estimate`;
}

function storageGet(keys: string | string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(items as Record<string, unknown>);
    });
  });
}

function storageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

export async function getCachedSnapshot(
  platform: PlatformId
): Promise<UsageSnapshot | null> {
  const key = snapshotKey(platform);
  const items = await storageGet(key);
  const value = items[key];
  if (!isUsageSnapshot(value, platform)) {
    return null;
  }
  return {
    ...value,
    cacheAgeMs: Math.max(0, Date.now() - value.updatedAt)
  };
}

export function setCachedSnapshot(snapshot: UsageSnapshot): Promise<void> {
  const { cacheAgeMs: _cacheAgeMs, ...persisted } = snapshot;
  return storageSet({ [snapshotKey(snapshot.platform)]: persisted });
}

export async function getLastRefreshAt(platform: PlatformId): Promise<number> {
  const key = lastRefreshKey(platform);
  const items = await storageGet(key);
  return typeof items[key] === "number" ? items[key] : 0;
}

export function setLastRefreshAt(
  platform: PlatformId,
  value: number
): Promise<void> {
  return storageSet({ [lastRefreshKey(platform)]: value });
}

export async function getBackoffUntil(platform: PlatformId): Promise<number> {
  const key = backoffKey(platform);
  const items = await storageGet(key);
  return typeof items[key] === "number" ? items[key] : 0;
}

export function setBackoffUntil(
  platform: PlatformId,
  value: number
): Promise<void> {
  return storageSet({ [backoffKey(platform)]: value });
}

export async function getFailureCount(platform: PlatformId): Promise<number> {
  const key = failureCountKey(platform);
  const items = await storageGet(key);
  return typeof items[key] === "number" ? items[key] : 0;
}

export function setFailureCount(
  platform: PlatformId,
  value: number
): Promise<void> {
  return storageSet({ [failureCountKey(platform)]: value });
}

export async function getEstimateState(
  platform: PlatformId
): Promise<EstimateState | null> {
  const key = estimateKey(platform);
  const items = await storageGet(key);
  const value = items[key];
  if (!isEstimateState(value)) {
    return null;
  }
  return value;
}

export async function incrementEstimateState(
  platform: PlatformId
): Promise<EstimateState> {
  const existing = await getEstimateState(platform);
  const now = Date.now();
  const next: EstimateState = {
    sentCount: (existing?.sentCount ?? 0) + 1,
    firstSentAt: existing?.firstSentAt ?? now,
    lastSentAt: now
  };
  await storageSet({ [estimateKey(platform)]: next });
  return next;
}

function isUsageSnapshot(
  value: unknown,
  platform: PlatformId
): value is UsageSnapshot {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as UsageSnapshot).platform === platform &&
    Array.isArray((value as UsageSnapshot).meters) &&
    typeof (value as UsageSnapshot).updatedAt === "number"
  );
}

function isEstimateState(value: unknown): value is EstimateState {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as EstimateState).sentCount === "number" &&
    typeof (value as EstimateState).firstSentAt === "number" &&
    typeof (value as EstimateState).lastSentAt === "number"
  );
}
