import type {
  ChatGPTSentinelObservation,
  ChatGPTSentinelState
} from "../platforms/chatgptSentinel";
import { containsForbiddenSentinelKey } from "../platforms/chatgptSentinel";

const OBSERVATION_LIMIT = 20;
const STATE_KEY = "aiUsage:chatgpt:sentinelState";
const OBSERVATIONS_KEY = "aiUsage:chatgpt:sentinelObservations";

export async function getChatGptSentinelState(): Promise<ChatGPTSentinelState | null> {
  const items = await storageGet(STATE_KEY);
  const value = items[STATE_KEY];
  return isChatGptSentinelState(value) ? value : null;
}

export async function rememberChatGptSentinelObservation(
  observation: ChatGPTSentinelObservation,
  state: ChatGPTSentinelState
): Promise<void> {
  if (containsForbiddenSentinelKey(observation) || containsForbiddenSentinelKey(state)) {
    return;
  }
  const existing = await getChatGptSentinelObservations();
  const observations = [observation, ...existing].slice(0, OBSERVATION_LIMIT);
  await storageSet({
    [STATE_KEY]: state,
    [OBSERVATIONS_KEY]: observations
  });
}

async function getChatGptSentinelObservations(): Promise<
  ChatGPTSentinelObservation[]
> {
  const items = await storageGet(OBSERVATIONS_KEY);
  const value = items[OBSERVATIONS_KEY];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isChatGptSentinelObservation).slice(0, OBSERVATION_LIMIT);
}

function storageGet(keys: string | string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(items as Record<string, unknown>);
    });
  });
}

function storageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function isChatGptSentinelObservation(
  value: unknown
): value is ChatGPTSentinelObservation {
  const candidate = value as ChatGPTSentinelObservation;
  return (
    typeof value === "object" &&
    value !== null &&
    candidate.source === "chatgpt-sentinel" &&
    (candidate.urlKind === "chat-requirements" || candidate.urlKind === "prepare") &&
    typeof candidate.ts === "number" &&
    typeof candidate.powRequired === "boolean"
  );
}

function isChatGptSentinelState(value: unknown): value is ChatGPTSentinelState {
  const candidate = value as ChatGPTSentinelState;
  return (
    typeof value === "object" &&
    value !== null &&
    typeof candidate.updatedAt === "number" &&
    typeof candidate.sentinelRisk?.score === "number" &&
    typeof candidate.sentinelRisk?.label === "string" &&
    typeof candidate.pow?.risk === "number" &&
    typeof candidate.gates?.powRequired === "boolean"
  );
}
