import { describe, expect, it, vi, afterEach } from "vitest";
import { migrateRetiredFeatures } from "../src/storage/migrations";
import { getCachedSnapshot, setCachedSnapshot } from "../src/storage/cache";
import type { UsageSnapshot } from "../src/platforms/types";

afterEach(() => vi.unstubAllGlobals());
describe("retired feature migration and scoped cache", () => {
  it("removes only known retired keys once, without reading IP key values", async () => {
    const values: Record<string, unknown> = {};
    const storage = { get: vi.fn(async (key: string) => ({ [key]: values[key] })), remove: vi.fn(async (_keys: string[]) => undefined), set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(values, items); }) };
    await migrateRetiredFeatures(storage); await migrateRetiredFeatures(storage);
    expect(storage.remove).toHaveBeenCalledTimes(2);
    expect(storage.remove.mock.calls[0][0]).toContain("aiUsage:ipRisk:settings");
    expect(storage.remove.mock.calls[0][0]).not.toContain("aiUsage:language");
    expect(storage.remove.mock.calls[1][0]).toEqual(["aiUsage:chatgpt:sentinelState", "aiUsage:chatgpt:sentinelObservations"]);
    expect(storage.get.mock.calls.every(([key]) => key.startsWith("aiUsage:migration:"))).toBe(true);
  });
  it("removes account-status records even when the earlier quota migration is already complete", async () => {
    const values: Record<string, unknown> = { "aiUsage:migration:quota-v2": true };
    const storage = { get: vi.fn(async (key: string) => ({ [key]: values[key] })), remove: vi.fn(async (_keys: string[]) => undefined), set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(values, items); }) };
    await migrateRetiredFeatures(storage); await migrateRetiredFeatures(storage);
    expect(storage.remove).toHaveBeenCalledOnce();
    expect(storage.remove.mock.calls[0][0]).toEqual(["aiUsage:chatgpt:sentinelState", "aiUsage:chatgpt:sentinelObservations"]);
    expect(storage.remove.mock.calls[0][0]).not.toContain("aiUsage:chatgpt:snapshot");
  });
  it("does not read an old platform-wide ChatGPT cache or persist an unknown scope", async () => {
    const get = vi.fn(), set = vi.fn();
    vi.stubGlobal("chrome", { runtime: {}, storage: { local: { get, set } } });
    const value: UsageSnapshot = { platform: "chatgpt", source: "api", updatedAt: 123, status: "ok", meters: [] };
    expect(await getCachedSnapshot("chatgpt")).toBeNull(); await setCachedSnapshot(value);
    expect(get).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled();
  });
  it("reads and writes separate hashed account cache keys", async () => {
    const data: Record<string, unknown> = {};
    const get = vi.fn((key: string, done: (items: Record<string, unknown>) => void) => done({ [key]: data[key] }));
    const set = vi.fn((items: Record<string, unknown>, done: () => void) => { Object.assign(data, items); done(); });
    vi.stubGlobal("chrome", { runtime: {}, storage: { local: { get, set } } });
    const value: UsageSnapshot = { platform: "chatgpt", scopeKey: "a".repeat(64), source: "api", updatedAt: 123, status: "ok", meters: [] };
    await setCachedSnapshot(value);
    expect((await getCachedSnapshot("chatgpt", "a".repeat(64)))?.scopeKey).toBe(value.scopeKey);
    expect(await getCachedSnapshot("chatgpt", "b".repeat(64))).toBeNull();
  });
});
