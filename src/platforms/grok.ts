import type {
  BridgeResponse,
  UsageEndpointFetcher,
  UsageMeter,
  UsageSnapshot,
  UsageSource
} from "./types";
import { formatUsageError, usageErrorFromBridge } from "./errors";

const GROK_ENDPOINT_KEY = "grok:credits-config" as const;
const GRPC_WEB_DATA_FRAME = 0;
const USAGE_PERIOD_LABELS: Record<number, string> = {
  1: "monthly",
  2: "weekly"
};
const PRODUCT_LABELS: Record<number, string> = {
  1: "Grok Build",
  2: "API",
  4: "Chat",
  5: "Imagine",
  6: "Build",
  7: "Voice",
  8: "API"
};

type ProtoField = {
  field: number;
  wireType: number;
  bytes?: Uint8Array;
  float?: number;
  varint?: bigint;
};

type GrokCreditsConfig = {
  creditUsagePercent: number | null;
  currentPeriod: {
    type: string;
    start: string | null;
    end: string | null;
  } | null;
  productUsage: Array<{
    product: number;
    usagePercent: number;
  }>;
};

export function normalizeGrokCreditsConfig(
  base64Text: string | undefined,
  options: { source?: UsageSource } = {}
): UsageMeter[] {
  const config = parseGrokCreditsConfig(base64Text);
  if (!config) {
    return [];
  }

  const source = options.source ?? "api";
  const resetAt = config.currentPeriod?.end ?? null;
  const period = config.currentPeriod?.type ?? "current";
  const meters: UsageMeter[] = [];
  const validProductUsage = config.productUsage.filter((item) =>
    Number.isFinite(item.usagePercent)
  );

  if (config.creditUsagePercent !== null || validProductUsage.length > 0) {
    const rawUsedPercent = validProductUsage.length > 0
      ? validProductUsage.reduce((sum, item) => sum + item.usagePercent, 0)
      : config.creditUsagePercent ?? 0;
    const usedPercent = percentFromGrokPercent(rawUsedPercent);
    meters.push({
      key: `grok:${period}:total`,
      label: `${titleCase(period)} Grok limit`,
      usedPercent,
      resetAt,
      source,
      confidence: resetAt ? "high" : "medium",
      rawKind: "grokCreditsConfig:total"
    });
  }

  for (const item of config.productUsage) {
    const label = PRODUCT_LABELS[item.product] ?? `Product ${item.product}`;
    const usedPercent = percentFromGrokPercent(item.usagePercent);
    if (usedPercent === null) {
      continue;
    }
    meters.push({
      key: `grok:${period}:${label.toLowerCase().replace(/\s+/g, "-")}`,
      label,
      usedPercent,
      resetAt,
      source,
      confidence: resetAt ? "high" : "medium",
      rawKind: `grokCreditsConfig:product:${item.product}`
    });
  }

  return meters;
}

function responseFailure(response: BridgeResponse): string {
  return formatUsageError(
    usageErrorFromBridge(response),
    response.endpointKey ?? "grok"
  );
}

export async function fetchGrokUsage(
  fetcher: UsageEndpointFetcher
): Promise<UsageSnapshot> {
  const response = await fetcher(GROK_ENDPOINT_KEY);
  const meters = response.ok
    ? normalizeGrokCreditsConfig(response.text, { source: "api" })
    : [];
  const failure = response.ok ? undefined : responseFailure(response);

  return {
    platform: "grok",
    meters,
    source: meters.length > 0 ? "api" : "unknown",
    updatedAt: Date.now(),
    status:
      meters.length > 0
        ? "ok"
        : failure
          ? "error"
          : "unknown",
    errorMessage: failure,
    debug: {
      endpoint: GROK_ENDPOINT_KEY,
      parser: "grok.creditsConfig.grpcWeb"
    }
  };
}

function parseGrokCreditsConfig(base64Text: string | undefined): GrokCreditsConfig | null {
  if (!base64Text) {
    return null;
  }
  let message: Uint8Array | null;
  try {
    message = firstGrpcWebMessage(base64ToBytes(base64Text));
  } catch {
    return null;
  }
  if (!message) {
    return null;
  }
  const rootConfig = fields(message).find(
    (field) => field.field === 1 && field.wireType === 2
  );
  if (!rootConfig?.bytes) {
    return null;
  }

  let creditUsagePercent: number | null = null;
  let currentPeriod: GrokCreditsConfig["currentPeriod"] = null;
  const productUsage: GrokCreditsConfig["productUsage"] = [];

  for (const field of fields(rootConfig.bytes)) {
    if (field.field === 1 && field.wireType === 5) {
      creditUsagePercent = finiteNumber(field.float);
    } else if (field.field === 7 && field.wireType === 2 && field.bytes) {
      const item = parseProductUsage(field.bytes);
      if (item) {
        productUsage.push(item);
      }
    } else if (field.field === 8 && field.wireType === 2 && field.bytes) {
      currentPeriod = parseCurrentPeriod(field.bytes);
    }
  }

  if (creditUsagePercent === null && productUsage.length === 0) {
    return null;
  }
  return {
    creditUsagePercent,
    currentPeriod,
    productUsage
  };
}

function parseProductUsage(
  bytes: Uint8Array
): { product: number; usagePercent: number } | null {
  let product: number | null = null;
  let usagePercent: number | null = null;
  for (const field of fields(bytes)) {
    if (field.field === 1 && field.wireType === 0 && field.varint !== undefined) {
      product = Number(field.varint);
    } else if (field.field === 2 && field.wireType === 5) {
      usagePercent = finiteNumber(field.float);
    }
  }
  if (product === null || usagePercent === null) {
    return null;
  }
  return { product, usagePercent };
}

function parseCurrentPeriod(bytes: Uint8Array): GrokCreditsConfig["currentPeriod"] {
  let type = "unspecified";
  let start: string | null = null;
  let end: string | null = null;
  for (const field of fields(bytes)) {
    if (field.field === 1 && field.wireType === 0 && field.varint !== undefined) {
      type = USAGE_PERIOD_LABELS[Number(field.varint)] ?? "unspecified";
    } else if (field.field === 2 && field.wireType === 2 && field.bytes) {
      start = parseTimestamp(field.bytes);
    } else if (field.field === 3 && field.wireType === 2 && field.bytes) {
      end = parseTimestamp(field.bytes);
    }
  }
  return { type, start, end };
}

function parseTimestamp(bytes: Uint8Array): string | null {
  let seconds: bigint | null = null;
  let nanos = 0;
  for (const field of fields(bytes)) {
    if (field.field === 1 && field.wireType === 0 && field.varint !== undefined) {
      seconds = field.varint;
    } else if (field.field === 2 && field.wireType === 0 && field.varint !== undefined) {
      nanos = Number(field.varint);
    }
  }
  if (seconds === null) {
    return null;
  }
  const millis = Number(seconds) * 1000 + Math.floor(nanos / 1_000_000);
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstGrpcWebMessage(bytes: Uint8Array): Uint8Array | null {
  let offset = 0;
  while (offset + 5 <= bytes.length) {
    const flag = bytes[offset];
    const length = readUint32Be(bytes, offset + 1);
    const start = offset + 5;
    const end = start + length;
    if (end > bytes.length) {
      return null;
    }
    if (flag === GRPC_WEB_DATA_FRAME) {
      return bytes.slice(start, end);
    }
    offset = end;
  }
  return null;
}

function fields(bytes: Uint8Array): ProtoField[] {
  const result: ProtoField[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const key = readVarint(bytes, offset);
    if (!key) {
      break;
    }
    offset = key.offset;
    const field = Number(key.value >> 3n);
    const wireType = Number(key.value & 7n);
    if (field <= 0) {
      break;
    }

    if (wireType === 0) {
      const value = readVarint(bytes, offset);
      if (!value) {
        break;
      }
      offset = value.offset;
      result.push({ field, wireType, varint: value.value });
    } else if (wireType === 2) {
      const length = readVarint(bytes, offset);
      if (!length) {
        break;
      }
      offset = length.offset;
      const end = offset + Number(length.value);
      if (end > bytes.length) {
        break;
      }
      result.push({ field, wireType, bytes: bytes.slice(offset, end) });
      offset = end;
    } else if (wireType === 5) {
      if (offset + 4 > bytes.length) {
        break;
      }
      result.push({
        field,
        wireType,
        float: new DataView(
          bytes.buffer,
          bytes.byteOffset + offset,
          4
        ).getFloat32(0, true)
      });
      offset += 4;
    } else {
      break;
    }
  }
  return result;
}

function readVarint(
  bytes: Uint8Array,
  offset: number
): { value: bigint; offset: number } | null {
  let value = 0n;
  let shift = 0n;
  let cursor = offset;
  while (cursor < bytes.length) {
    const byte = BigInt(bytes[cursor]);
    cursor += 1;
    value |= (byte & 0x7fn) << shift;
    if ((byte & 0x80n) === 0n) {
      return { value, offset: cursor };
    }
    shift += 7n;
    if (shift > 63n) {
      return null;
    }
  }
  return null;
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function finiteNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percentFromGrokPercent(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, value));
}

function titleCase(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}
