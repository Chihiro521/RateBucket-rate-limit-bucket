import { MUSE_ENDPOINT_KEY, parseMuseSubscriptionText } from "../platforms/muse";
import type { BridgeResponse } from "../platforms/types";
import { SOURCE } from "../utils/protocol";

export function findMuseSubscriptionAction(script: string): string | null {
  return /createServerReference\s*\)?\s*\(\s*["']([a-f0-9]{40,64})["'][^;]{0,250}?["']fetchSubscriptionAction["']/i.exec(script)?.[1] ?? null;
}

export class MuseSubscriptionBridge {
  private actionId: string | null = null;
  private readonly scannedScripts = new Map<string, string | null>();
  private inFlight: Promise<BridgeResponse> | null = null;

  constructor(
    private readonly fetcher: typeof fetch,
    private readonly pageDocument: Document = document,
    private readonly origin = window.location.origin
  ) {}

  matches(url: URL, method: string, actionId: string | null): boolean {
    return this.origin === "https://muse.ai" && url.origin === this.origin &&
      url.pathname === "/" && method.toUpperCase() === "POST" &&
      this.actionId !== null && actionId === this.actionId;
  }

  async fetchUsage(requestId: string): Promise<BridgeResponse> {
    const pending = this.inFlight ?? (this.inFlight = this.queryUsage(requestId));
    try {
      return { ...await pending, requestId };
    } finally {
      if (this.inFlight === pending) this.inFlight = null;
    }
  }

  private async queryUsage(requestId: string): Promise<BridgeResponse> {
    const requestedAt = Date.now();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    let stage: "discovery" | "request" | "response" = "discovery";
    const base = { source: SOURCE, direction: "main-to-content" as const, requestId,
      platform: "muse" as const, endpointKey: MUSE_ENDPOINT_KEY, requestStartedAt: requestedAt };
    try {
      if (this.origin !== "https://muse.ai") throw new Error("Muse 额度只能从 Muse 页面查询");
      for (let attempt = 0; attempt < 2; attempt++) {
        stage = "discovery";
        const actionId = this.actionId ?? await this.discoverAction(controller.signal);
        stage = "request";
        const response = await this.fetcher(`${this.origin}/`, {
          method: "POST", credentials: "include", cache: "no-store", signal: controller.signal,
          headers: { Accept: "text/x-component", "Content-Type": "text/plain;charset=UTF-8", "Next-Action": actionId },
          body: '[{"includeAgreement":false}]'
        });
        if (response.redirected && response.url.startsWith("https://auth.muse.ai/")) {
          return { ...base, ok: false, error: { status: 401, message: "请登录 Muse 后刷新额度" } };
        }
        stage = "response";
        const text = await response.text();
        const missingAction = response.status === 404 || response.headers.get("x-nextjs-action-not-found") === "1" ||
          /Failed to find Server Action|Server Action[^\n]*not found/i.test(text);
        if (missingAction) {
          this.actionId = null;
          this.scannedScripts.clear();
          if (attempt === 0) continue;
          return { ...base, ok: false, error: { message: "Muse 额度接口已更新，请重新加载页面" } };
        }
        if (!response.ok) return { ...base, ok: false, error: { status: response.status, message: response.statusText || "Muse 额度接口请求失败" } };
        const result = parseMuseSubscriptionText(text);
        if (!result) return { ...base, ok: false, error: { code: "PARSER_ERROR", message: "Muse 额度响应结构变化" } };
        if (!result.success) return { ...base, ok: false, error: { status: result.unauthorized ? 401 : undefined, message: result.error } };
        return { ...base, ok: true, json: result, observedAt: Date.now() };
      }
      throw new Error("Muse 额度接口已更新，请重新加载页面");
    } catch (error) {
      const timeoutMessage = stage === "discovery" ? "识别 Muse 额度接口超时，请刷新页面后重试"
        : stage === "request" ? "Muse 额度请求超时，请稍后刷新" : "Muse 额度响应读取超时，请稍后刷新";
      return { ...base, ok: false, error: { code: controller.signal.aborted ? "NETWORK_ERROR" : "UNKNOWN", message: controller.signal.aborted
        ? timeoutMessage
        : error instanceof Error ? error.message : "Muse 额度查询失败" } };
    } finally {
      window.clearTimeout(timeout);
    }
  }

  private async discoverAction(signal: AbortSignal): Promise<string> {
    while (!signal.aborted) {
      const urls = Array.from(new Set(Array.from(this.pageDocument.scripts).map((script) => script.src)))
        .filter((src) => {
          try {
            const url = new URL(src);
            return url.origin === this.origin && /^\/_next\/static\/chunks\/.*\.js$/.test(url.pathname) && !this.scannedScripts.has(src);
          } catch { return false; }
        }).reverse();
      // Application/action chunks usually follow shared runtime chunks. Keep
      // four workers moving independently so an unrelated slow chunk cannot
      // block the queue or delay a reference another worker already found.
      const actionId = await this.scanScripts(urls, signal);
      if (actionId) return actionId;
      // Chunks arrive after document_start and during hydration. Observe new
      // script elements instead of requiring the settings screen to be open.
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) { reject(new Error("Muse action discovery timed out")); return; }
        const observer = new MutationObserver(() => { cleanup(); resolve(); });
        const abort = (): void => { cleanup(); reject(new Error("Muse action discovery timed out")); };
        const cleanup = (): void => { observer.disconnect(); signal.removeEventListener("abort", abort); };
        observer.observe(this.pageDocument, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
        signal.addEventListener("abort", abort, { once: true });
        // Catch a chunk appended between reading the script list and observing.
        if (Array.from(this.pageDocument.scripts).some((script) => !this.scannedScripts.has(script.src) && urls.includes(script.src) === false && script.src.startsWith(`${this.origin}/_next/static/chunks/`))) {
          cleanup(); resolve();
        }
      });
    }
    throw new Error("Muse action discovery timed out");
  }

  private scanScripts(urls: string[], signal: AbortSignal): Promise<string | null> {
    if (!urls.length) return Promise.resolve(null);
    const controller = new AbortController();
    return new Promise((resolve, reject) => {
      let nextIndex = 0;
      const workerCount = Math.min(4, urls.length);
      let activeWorkers = workerCount;
      let finished = false;
      const finish = (actionId: string | null, error?: Error): void => {
        if (finished) return;
        finished = true;
        signal.removeEventListener("abort", abort);
        controller.abort();
        if (error) reject(error);
        else resolve(actionId);
      };
      const abort = (): void => finish(null, new Error("Muse action discovery timed out"));
      const worker = async (): Promise<void> => {
        try {
          while (!finished && nextIndex < urls.length) {
            const url = urls[nextIndex++];
            try {
              const response = await this.fetcher(url, { credentials: "same-origin", cache: "force-cache", signal: controller.signal });
              if (!response.ok || finished) continue;
              const actionId = findMuseSubscriptionAction(await response.text());
              if (finished) return;
              this.scannedScripts.set(url, actionId);
              if (actionId) {
                this.actionId = actionId;
                finish(actionId);
              }
            } catch {
              if (signal.aborted) abort();
            }
          }
        } finally {
          if (--activeWorkers === 0) finish(null);
        }
      };
      if (signal.aborted) { abort(); return; }
      signal.addEventListener("abort", abort, { once: true });
      for (let index = 0; index < workerCount; index++) void worker();
    });
  }
}
