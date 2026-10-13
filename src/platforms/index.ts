import { fetchChatGptUsage } from "./chatgpt";
import { fetchClaudeUsage } from "./claude";
import { fetchGeminiUsage } from "./gemini";
import { fetchGrokUsage } from "./grok";
import { fetchKimiUsage } from "./kimi";
import { fetchPerplexityUsage } from "./perplexity";
import { fetchMuseUsage } from "./muse";
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
  if (platform === "gemini") {
    return fetchGeminiUsage(fetcher);
  }
  if (platform === "perplexity") {
    return fetchPerplexityUsage(fetcher);
  }
  if (platform === "muse") {
    return fetchMuseUsage(fetcher);
  }
  return fetchChatGptUsage(fetcher);
}
