export type PlatformId = "grok" | "claude" | "chatgpt";

export type UsageSource = "api" | "intercepted" | "estimate" | "unknown";

export type Confidence = "high" | "medium" | "low";

export type UsageMeter = {
  key: string;
  label: string;
  remaining?: number | null;
  total?: number | null;
  used?: number | null;
  usedPercent?: number | null;
  resetAt?: string | number | null;
  resetAfterSeconds?: number | null;
  windowSeconds?: number | null;
  source: UsageSource;
  confidence: Confidence;
  rawKind?: string;
};

export type UsageSnapshot = {
  platform: PlatformId;
  meters: UsageMeter[];
  source: UsageSource;
  updatedAt: number;
  cacheAgeMs?: number;
  status: "ok" | "partial" | "unknown" | "error";
  errorMessage?: string;
  debug?: {
    endpoint?: string;
    parser?: string;
  };
};

export type UsageError = {
  code:
    | "UNAUTHORIZED"
    | "RATE_LIMITED"
    | "NETWORK_ERROR"
    | "PARSER_ERROR"
    | "ENDPOINT_CHANGED"
    | "UNKNOWN";
  message: string;
  status?: number;
};

export type EndpointKey =
  | "grok:grok-3"
  | "grok:grok-4-heavy"
  | "claude:organizations"
  | "claude:usage"
  | "chatgpt:conversationInit"
  | "chatgpt:whamUsage"
  | "chatgpt:whamTasksRateLimit"
  | "chatgpt:codexSettingsUsage";

export type BridgeAction = "fetchUsage" | "enableIntercept";

export type BridgeRequest = {
  source: "ai-usage-floating-monitor";
  direction: "content-to-main";
  requestId: string;
  action: BridgeAction;
  platform: PlatformId;
  endpointKey?: EndpointKey;
  payload?: unknown;
};

export type BridgeResponse = {
  source: "ai-usage-floating-monitor";
  direction: "main-to-content";
  requestId: string;
  ok: boolean;
  platform: PlatformId;
  endpointKey?: EndpointKey;
  json?: unknown;
  error?: {
    status?: number;
    message: string;
  };
};

export type InterceptedUsageMessage = {
  source: "ai-usage-floating-monitor";
  direction: "main-to-content";
  kind: "interceptedUsage";
  platform: PlatformId;
  endpointKey?: EndpointKey;
  url: string;
  json: unknown;
  ts: number;
};

export type UsageEndpointFetcher = (
  endpointKey: EndpointKey,
  payload?: unknown
) => Promise<BridgeResponse>;
