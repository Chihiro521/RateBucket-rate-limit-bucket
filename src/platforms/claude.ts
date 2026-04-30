import type {
  BridgeResponse,
  UsageEndpointFetcher,
  UsageMeter,
  UsageSnapshot,
  UsageSource
} from "./types";
import {
  asArray,
  asBoolean,
  asRecord,
  getNumber,
  getString,
  percentFromRatioOrPercent,
  titleFromKey
} from "../utils/safeJson";
import { formatUsageError, usageErrorFromBridge } from "./errors";

const FRIENDLY_LABELS: Record<string, string> = {
  five_hour: "5h",
  seven_day: "7d all models",
  seven_day_sonnet: "7d Sonnet",
  seven_day_opus: "7d Opus",
  seven_day_omelette: "7d Design / Omelette",
  extra_usage: "Extra Usage"
};

export function extractClaudeOrgId(json: unknown): string | null {
  const root = asRecord(json);
  const candidates = Array.isArray(json)
    ? json
    : root
      ? asArray(root.organizations)
      : [];

  for (const item of candidates) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    const uuid = getString(record, "uuid");
    const id = getString(record, "id");
    if (uuid) {
      return uuid;
    }
    if (id) {
      return id;
    }
  }
  return null;
}

function isUsageLike(record: Record<string, unknown>): boolean {
  return (
    "utilization" in record ||
    "used_percentage" in record ||
    "used_credits" in record ||
    "monthly_limit" in record
  );
}

function normalizeUsageObject(
  key: string,
  record: Record<string, unknown>,
  source: UsageSource
): UsageMeter | null {
  if (!isUsageLike(record)) {
    return null;
  }
  const utilization =
    getNumber(record, "utilization") ?? getNumber(record, "used_percentage");
  const usedPercent = percentFromRatioOrPercent(utilization);
  const resetAt = getString(record, "resets_at");
  const total = getNumber(record, "monthly_limit");
  const used = getNumber(record, "used_credits");
  const remaining =
    total !== null && used !== null ? Math.max(0, total - used) : null;
  const isEnabled = asBoolean(record.is_enabled);

  const hasAnyValue =
    usedPercent !== null ||
    resetAt !== null ||
    total !== null ||
    used !== null ||
    isEnabled !== null;
  if (!hasAnyValue) {
    return null;
  }

  return {
    key,
    label: FRIENDLY_LABELS[key] ?? titleFromKey(key),
    remaining,
    total,
    used,
    usedPercent,
    resetAt,
    source,
    confidence:
      usedPercent !== null && resetAt !== null
        ? "high"
        : usedPercent !== null || total !== null || used !== null
          ? "medium"
          : "low",
    rawKind: key
  };
}

export function normalizeClaudeUsage(
  json: unknown,
  source: UsageSource = "api"
): UsageMeter[] {
  const root = asRecord(json);
  if (!root) {
    return [];
  }
  const meters: UsageMeter[] = [];
  for (const [key, value] of Object.entries(root)) {
    const record = asRecord(value);
    if (!record) {
      continue;
    }
    const meter = normalizeUsageObject(key, record, source);
    if (meter) {
      meters.push(meter);
    }
  }
  return meters;
}

function responseFailure(response: BridgeResponse): string {
  return formatUsageError(
    usageErrorFromBridge(response),
    response.endpointKey ?? "claude"
  );
}

export async function fetchClaudeUsage(
  fetcher: UsageEndpointFetcher
): Promise<UsageSnapshot> {
  const organizations = await fetcher("claude:organizations");
  if (!organizations.ok) {
    return {
      platform: "claude",
      meters: [],
      source: "unknown",
      updatedAt: Date.now(),
      status: "error",
      errorMessage: responseFailure(organizations),
      debug: {
        endpoint: "claude:organizations",
        parser: "claude.organizations"
      }
    };
  }

  const orgId = extractClaudeOrgId(organizations.json);
  if (!orgId) {
    return {
      platform: "claude",
      meters: [],
      source: "unknown",
      updatedAt: Date.now(),
      status: "error",
      errorMessage: "No Claude organization id found",
      debug: {
        endpoint: "claude:organizations",
        parser: "claude.organizations"
      }
    };
  }

  const usage = await fetcher("claude:usage", { orgId });
  if (!usage.ok) {
    return {
      platform: "claude",
      meters: [],
      source: "unknown",
      updatedAt: Date.now(),
      status: "error",
      errorMessage: responseFailure(usage),
      debug: {
        endpoint: "claude:usage",
        parser: "claude.usage"
      }
    };
  }

  const meters = normalizeClaudeUsage(usage.json, "api");
  return {
    platform: "claude",
    meters,
    source: meters.length > 0 ? "api" : "unknown",
    updatedAt: Date.now(),
    status: meters.length > 0 ? "ok" : "unknown",
    debug: {
      endpoint: "claude:usage",
      parser: "claude.usage"
    }
  };
}
