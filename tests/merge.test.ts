import { describe, expect, it } from "vitest";
import { MERGED_METER_TTL_MS, mergeUsageSnapshots } from "../src/platforms/merge";
import type { UsageSnapshot } from "../src/platforms/types";

function snapshot(args: {
  updatedAt: number;
  key: string;
  label: string;
  source?: "api" | "intercepted";
  status?: UsageSnapshot["status"];
}): UsageSnapshot {
  return {
    platform: "chatgpt",
    meters: [
      {
        key: args.key,
        label: args.label,
        remaining: 1,
        source: args.source ?? "api",
        confidence: "high"
      }
    ],
    source: args.source ?? "api",
    updatedAt: args.updatedAt,
    status: args.status ?? "ok"
  };
}

describe("mergeUsageSnapshots", () => {
  it("keeps meters from different endpoints instead of replacing the snapshot", () => {
    const existing = snapshot({
      updatedAt: 1_000,
      key: "limits_progress:file_upload",
      label: "File Upload"
    });
    const incoming = snapshot({
      updatedAt: 2_000,
      key: "wham:primary_window",
      label: "Primary window",
      source: "intercepted"
    });

    const merged = mergeUsageSnapshots(existing, incoming, 2_000);

    expect(merged.meters.map((meter) => meter.key)).toEqual([
      "limits_progress:file_upload",
      "wham:primary_window"
    ]);
    expect(merged.updatedAt).toBe(2_000);
    expect(merged.meters.every((meter) => typeof meter.observedAt === "number")).toBe(
      true
    );
  });

  it("replaces a meter with the same key using the newest value", () => {
    const existing = snapshot({
      updatedAt: 1_000,
      key: "limits_progress:file_upload",
      label: "File Upload"
    });
    const incoming: UsageSnapshot = {
      ...snapshot({
        updatedAt: 2_000,
        key: "limits_progress:file_upload",
        label: "File Upload"
      }),
      meters: [
        {
          key: "limits_progress:file_upload",
          label: "File Upload",
          remaining: 3,
          source: "intercepted",
          confidence: "high"
        }
      ]
    };

    const merged = mergeUsageSnapshots(existing, incoming, 2_000);

    expect(merged.meters).toHaveLength(1);
    expect(merged.meters[0]).toMatchObject({
      key: "limits_progress:file_upload",
      remaining: 3,
      source: "intercepted"
    });
  });

  it("drops stale retained meters after the merge ttl", () => {
    const existing = snapshot({
      updatedAt: 1_000,
      key: "limits_progress:file_upload",
      label: "File Upload"
    });
    const incoming = snapshot({
      updatedAt: MERGED_METER_TTL_MS + 2_000,
      key: "wham:primary_window",
      label: "Primary window"
    });

    const merged = mergeUsageSnapshots(
      existing,
      incoming,
      MERGED_METER_TTL_MS + 2_000
    );

    expect(merged.meters.map((meter) => meter.key)).toEqual(["wham:primary_window"]);
  });
});
