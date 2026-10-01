import { CHATGPT_USAGE_ENDPOINTS, normalizeChatGptEndpoint } from "../platforms/chatgpt";
import { MERGED_METER_TTL_MS, mergeUsageSnapshots } from "../platforms/merge";
import { hasMeaningfulValue, isChatPassPath } from "../platforms/presentation";
import type { BridgeResponse, EndpointKey, UsageEndpointFetcher, UsageMeter, UsageSnapshot } from "../platforms/types";
import { sameUsageValues } from "./usagePolling";

export const CHATGPT_REFRESH_MS = 30_000;
export const CHATGPT_OPERATION_INTERVAL_MS = 5_000;
type Reason = "startup" | "poll" | "manual" | "operation";
type EndpointState = { lastSuccess: number; retryAt: number; failures: number; flight?: Promise<void> };
type Options = {
  fetcher: UsageEndpointFetcher;
  onSnapshot: (snapshot: UsageSnapshot | null) => void;
  onLoading: (loading: boolean) => void;
  readCache: (scope: string) => Promise<UsageSnapshot | null>;
  writeCache: (snapshot: UsageSnapshot) => Promise<void>;
  now?: () => number;
};

export class ChatGptUsageController {
  private snapshot: UsageSnapshot | null = null;
  private scope?: string;
  private epoch = 0;
  private states = new Map<EndpointKey, EndpointState>();
  private lastOperation = -Infinity;
  private loading = 0;
  private scopeLoad?: Promise<void>;
  private writes = Promise.resolve();
  private disposed = false;
  private now: () => number;

  constructor(private options: Options) { this.now = options.now ?? Date.now; }

  reset(): void {
    this.epoch++;
    this.scope = undefined;
    this.scopeLoad = undefined;
    this.snapshot = null;
    this.states.clear();
    this.loading = 0;
    this.options.onLoading(false);
    this.lastOperation = -Infinity;
    this.options.onSnapshot(null);
  }

  destroy(): void { this.disposed = true; this.epoch++; }

  async refresh(reason: Reason = "poll"): Promise<void> {
    if (this.disposed) return;
    if (this.loading > 0 && (reason === "manual" || reason === "operation")) {
      await Promise.all([...this.states.values()].flatMap((state) => state.flight ? [state.flight] : []));
      return;
    }
    const now = this.now();
    if (reason === "operation" || reason === "manual") {
      if (now - this.lastOperation < CHATGPT_OPERATION_INTERVAL_MS) return;
      this.lastOperation = now;
    }
    const epoch = this.epoch;
    const queries: Promise<void>[] = [];
    for (const key of CHATGPT_USAGE_ENDPOINTS) {
      const state = this.state(key);
      if (state.flight) { queries.push(state.flight); continue; }
      if (state.retryAt > now) continue;
      if (reason === "poll" && state.lastSuccess > 0 && now - state.lastSuccess < CHATGPT_REFRESH_MS) continue;
      const flight = this.query(key, state, epoch);
      state.flight = flight;
      void flight.finally(() => { if (state.flight === flight) state.flight = undefined; });
      queries.push(flight);
    }
    if (!queries.length) { this.publish(); return; }
    this.loading++;
    this.options.onLoading(true);
    try {
      await Promise.all(queries);
      if (epoch === this.epoch && !this.disposed) {
        if (!this.snapshot) this.snapshot = this.empty();
        this.snapshot = { ...this.snapshot, checkedAt: this.now() };
        this.publish();
      }
    } finally {
      if (epoch === this.epoch && !this.disposed) {
        this.loading--;
        this.options.onLoading(this.loading > 0);
      }
    }
  }

  async acceptIntercept(key: EndpointKey, json: unknown, observedAt: number, requestedAt = observedAt, scope?: string): Promise<void> {
    const epoch = this.epoch;
    if (this.scope && !scope) return;
    await this.adoptScope(scope);
    if (this.disposed || epoch !== this.epoch) return;
    const meters = this.stamp(normalizeChatGptEndpoint(key, json, "intercepted"), observedAt, requestedAt);
    if (!meters.length) return;
    const state = this.state(key);
    state.lastSuccess = Math.max(state.lastSuccess, observedAt);
    state.retryAt = 0;
    state.failures = 0;
    this.accept(meters, observedAt);
  }

  private state(key: EndpointKey): EndpointState {
    let state = this.states.get(key);
    if (!state) { state = { lastSuccess: 0, retryAt: 0, failures: 0 }; this.states.set(key, state); }
    return state;
  }

  private async adoptScope(scope?: string): Promise<void> {
    if (!scope) return;
    if (this.scope === scope) { await this.scopeLoad; return; }
    const epoch = this.epoch;
    this.scope = scope;
    this.snapshot = null;
    this.scopeLoad = this.options.readCache(scope).then((cached) => {
      if (epoch !== this.epoch || this.scope !== scope || this.disposed) return;
      if (cached?.scopeKey === scope) {
        this.snapshot = cached;
        this.publish();
      }
    }).catch(() => undefined);
    await this.scopeLoad;
  }

  private async query(key: EndpointKey, state: EndpointState, epoch: number): Promise<void> {
    const started = this.now();
    let response: BridgeResponse;
    try { response = await this.options.fetcher(key); }
    catch { response = { source: "ai-usage-floating-monitor", direction: "main-to-content", requestId: "failed", platform: "chatgpt", ok: false }; }
    if (epoch !== this.epoch || this.disposed) return;
    if (response.ok) {
      await this.adoptScope(response.scopeKey);
      if (epoch !== this.epoch || this.disposed) return;
      const observedAt = response.observedAt ?? this.now();
      const meters = this.stamp(normalizeChatGptEndpoint(key, response.json), observedAt, response.requestStartedAt ?? started);
      if (meters.length) {
        state.lastSuccess = observedAt;
        state.retryAt = 0;
        state.failures = 0;
        this.accept(meters, observedAt);
        return;
      }
    }
    // A passive response received during this request is newer than its failure.
    if (state.lastSuccess > started) return;
    state.failures++;
    const status = response.error?.status;
    state.retryAt = this.now() + (status === 403 || status === 404 ? 300_000 :
      [60_000, 120_000, 300_000][Math.min(state.failures - 1, 2)]);
    this.publish();
  }

  private stamp(meters: UsageMeter[], observedAt: number, requestStartedAt: number): UsageMeter[] {
    return meters.filter(hasMeaningfulValue).map((meter) => ({ ...meter, observedAt, requestStartedAt,
      resetAt: meter.resetAfterSeconds !== null && meter.resetAfterSeconds !== undefined
        ? observedAt + meter.resetAfterSeconds * 1000 : meter.resetAt }));
  }

  private accept(meters: UsageMeter[], time: number): void {
    const previous = this.snapshot;
    const incoming: UsageSnapshot = { platform: "chatgpt", scopeKey: this.scope, meters,
      source: meters[0]?.source ?? "api", updatedAt: time, status: "ok" };
    const merged = mergeUsageSnapshots(previous, incoming, this.now());
    if (sameUsageValues(previous, merged)) merged.updatedAt = previous!.updatedAt;
    this.snapshot = merged;
    this.publish();
  }

  private empty(): UsageSnapshot {
    return { platform: "chatgpt", scopeKey: this.scope, meters: [], source: "unknown", updatedAt: this.now(), status: "unknown" };
  }

  private publish(): void {
    if (this.disposed) return;
    if (!this.snapshot) this.snapshot = this.empty();
    const meters = this.snapshot.meters.filter((meter) => !isChatPassPath(meter.key) &&
      this.now() - (meter.observedAt ?? this.snapshot!.updatedAt) <= MERGED_METER_TTL_MS);
    const failed = [...this.states.values()].some((state) => state.failures > 0);
    this.snapshot = { ...this.snapshot, meters,
      status: meters.length ? failed || meters.some((meter) => meter.quotaState === "blocked") ? "partial" : "ok" : failed ? "error" : "unknown",
      errorMessage: failed ? meters.length ? "部分查询失败，保留上次数据" : "暂时无法获取额度" : undefined };
    this.options.onSnapshot(this.snapshot);
    if (this.scope && meters.length) {
      const value = this.snapshot;
      this.writes = this.writes.then(() => this.options.writeCache(value)).catch(() => undefined);
    }
  }
}
