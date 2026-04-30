import type {
  BridgeRequest,
  BridgeResponse,
  InterceptedUsageMessage
} from "../platforms/types";
import { isRecord } from "./safeJson";

export const SOURCE = "ai-usage-floating-monitor" as const;

export function isBridgeRequest(value: unknown): value is BridgeRequest {
  return (
    isRecord(value) &&
    value.source === SOURCE &&
    value.direction === "content-to-main" &&
    typeof value.requestId === "string" &&
    typeof value.action === "string" &&
    typeof value.platform === "string"
  );
}

export function isBridgeResponse(value: unknown): value is BridgeResponse {
  return (
    isRecord(value) &&
    value.source === SOURCE &&
    value.direction === "main-to-content" &&
    typeof value.requestId === "string" &&
    typeof value.ok === "boolean" &&
    typeof value.platform === "string" &&
    !("kind" in value)
  );
}

export function isInterceptedUsageMessage(
  value: unknown
): value is InterceptedUsageMessage {
  return (
    isRecord(value) &&
    value.source === SOURCE &&
    value.direction === "main-to-content" &&
    value.kind === "interceptedUsage" &&
    typeof value.platform === "string" &&
    typeof value.url === "string" &&
    typeof value.ts === "number"
  );
}
