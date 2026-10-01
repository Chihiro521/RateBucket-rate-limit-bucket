type MigrationStorage = {
  get: (key: string) => Promise<Record<string, unknown>>;
  remove: (keys: string[]) => Promise<void>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

export async function migrateRetiredFeatures(storage: MigrationStorage): Promise<void> {
  const migrations = [
    { key: "aiUsage:migration:quota-v2", removedKeys: [
      "aiUsage:ipRisk:settings", "aiUsage:ipRisk:state", "aiUsage:chatgpt:snapshot",
      "aiUsage:chatgpt:lastRefreshAt", "aiUsage:chatgpt:backoffUntil", "aiUsage:chatgpt:failureCount"
    ] },
    { key: "aiUsage:migration:retire-account-status-v1", removedKeys: [
      "aiUsage:chatgpt:sentinelState", "aiUsage:chatgpt:sentinelObservations"
    ] }
  ];
  for (const { key, removedKeys } of migrations) {
    if ((await storage.get(key))[key]) continue;
    await storage.remove(removedKeys);
    await storage.set({ [key]: true });
  }
}
