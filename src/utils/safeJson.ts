export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function getRecord(record: JsonRecord, key: string): JsonRecord | null {
  return asRecord(record[key]);
}

export function getArray(record: JsonRecord, key: string): unknown[] {
  return asArray(record[key]);
}

export function getNumber(record: JsonRecord, key: string): number | null {
  return asNumber(record[key]);
}

export function getString(record: JsonRecord, key: string): string | null {
  return asString(record[key]);
}

export function percentFromRatioOrPercent(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  const percent = value >= 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, percent));
}

export function titleFromKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1));
}
