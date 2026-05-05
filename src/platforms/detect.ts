import type { PlatformId } from "./types";

export function detectPlatform(location: Location): PlatformId | null {
  const hostname = location.hostname.toLowerCase();
  if (hostname === "grok.com" || hostname.endsWith(".grok.com")) {
    return "grok";
  }
  if (hostname === "claude.ai" || hostname.endsWith(".claude.ai")) {
    return "claude";
  }
  if (hostname === "chatgpt.com" || hostname.endsWith(".chatgpt.com")) {
    return "chatgpt";
  }
  if (hostname === "www.kimi.com" || hostname === "kimi.com") {
    return "kimi";
  }
  return null;
}
