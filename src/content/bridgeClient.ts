import type {
  BridgeResponse,
  EndpointKey,
  InterceptedUsageMessage,
  PlatformId
} from "../platforms/types";
import {
  isBridgeResponse,
  isInterceptedUsageMessage,
  SOURCE
} from "../utils/protocol";

type PendingRequest = {
  resolve: (response: BridgeResponse) => void;
  timeoutId: number;
  platform: PlatformId;
  endpointKey?: EndpointKey;
};

type InterceptHandler = (message: InterceptedUsageMessage) => void;

export class BridgeClient {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly interceptHandlers = new Set<InterceptHandler>();
  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== window || event.origin !== window.location.origin) {
      return;
    }

    if (isInterceptedUsageMessage(event.data)) {
      for (const handler of this.interceptHandlers) {
        handler(event.data);
      }
      return;
    }

    if (!isBridgeResponse(event.data)) {
      return;
    }

    const pending = this.pending.get(event.data.requestId);
    if (!pending) {
      return;
    }
    window.clearTimeout(pending.timeoutId);
    this.pending.delete(event.data.requestId);
    pending.resolve(event.data);
  };

  constructor() {
    window.addEventListener("message", this.onMessage);
  }

  destroy(): void {
    window.removeEventListener("message", this.onMessage);
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeoutId);
    }
    this.pending.clear();
    this.interceptHandlers.clear();
  }

  onIntercepted(handler: InterceptHandler): () => void {
    this.interceptHandlers.add(handler);
    return () => this.interceptHandlers.delete(handler);
  }

  fetchUsage(
    platform: PlatformId,
    endpointKey: EndpointKey,
    payload?: unknown
  ): Promise<BridgeResponse> {
    return this.send(platform, "fetchUsage", endpointKey, payload);
  }

  enableIntercept(platform: PlatformId): Promise<BridgeResponse> {
    return this.send(platform, "enableIntercept");
  }

  private send(
    platform: PlatformId,
    action: "fetchUsage" | "enableIntercept",
    endpointKey?: EndpointKey,
    payload?: unknown
  ): Promise<BridgeResponse> {
    const requestId = makeRequestId();
    return new Promise((resolve) => {
      const timeoutId = window.setTimeout(() => {
        this.pending.delete(requestId);
        resolve({
          source: SOURCE,
          direction: "main-to-content",
          requestId,
          ok: false,
          platform,
          endpointKey,
          error: {
            message: "Bridge request timed out"
          }
        });
      }, 12_000);

      this.pending.set(requestId, {
        resolve,
        timeoutId,
        platform,
        endpointKey
      });

      window.postMessage(
        {
          source: SOURCE,
          direction: "content-to-main",
          requestId,
          action,
          platform,
          endpointKey,
          payload
        },
        window.location.origin
      );
    });
  }
}

function makeRequestId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
