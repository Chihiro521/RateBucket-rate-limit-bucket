export function isDebugEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem("aiUsageDebug") === "1";
  } catch {
    return false;
  }
}

export function debugLog(message: string, details?: unknown): void {
  if (!isDebugEnabled()) {
    return;
  }
  if (details === undefined) {
    console.debug(`[ai-usage] ${message}`);
    return;
  }
  console.debug(`[ai-usage] ${message}`, details);
}
