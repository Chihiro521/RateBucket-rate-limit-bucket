import type { BridgeResponse, UsageError } from "./types";

export function usageErrorFromBridge(response: BridgeResponse): UsageError {
  const status = response.error?.status;
  if (status === 401 || status === 403) {
    return {
      code: "UNAUTHORIZED",
      message: "未授权或当前页面无法读取",
      status
    };
  }
  if (status === 429) {
    return {
      code: "RATE_LIMITED",
      message: "接口限流，稍后手动刷新",
      status
    };
  }
  if (typeof status === "number" && status >= 500) {
    return {
      code: "NETWORK_ERROR",
      message: "平台接口暂时不可用",
      status
    };
  }
  return {
    code: "UNKNOWN",
    message: response.error?.message ?? "Unknown usage fetch error",
    status
  };
}

export function formatUsageError(error: UsageError, endpoint?: string): string {
  const prefix = endpoint ? `${endpoint}: ` : "";
  const status = error.status ? `${error.status} ` : "";
  return `${prefix}${status}${error.message}`;
}
