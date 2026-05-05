import { fetchChatGptUsage } from "./chatgpt";
import { fetchClaudeUsage } from "./claude";
import { fetchGrokUsage } from "./grok";
import { fetchKimiUsage } from "./kimi";
import type { PlatformId, UsageEndpointFetcher, UsageSnapshot } from "./types";

export function fetchPlatformUsage(
  platform: PlatformId,
  fetcher: UsageEndpointFetcher
): Promise<UsageSnapshot> {
  if (platform === "grok") {
    return fetchGrokUsage(fetcher);
  }
  if (platform === "claude") {
    return fetchClaudeUsage(fetcher);
  }
  if (platform === "kimi") {
    return fetchKimiUsage();
  }
  return fetchChatGptUsage(fetcher);
}
