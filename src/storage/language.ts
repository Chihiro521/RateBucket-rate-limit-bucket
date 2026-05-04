import {
  languageModeFromValue,
  type LanguageMode
} from "../utils/i18n";

export const LANGUAGE_SETTINGS_KEY = "aiUsage:language";

export async function getLanguageMode(): Promise<LanguageMode> {
  const items = await storageGet(LANGUAGE_SETTINGS_KEY);
  return languageModeFromStorageValue(items[LANGUAGE_SETTINGS_KEY]);
}

export async function saveLanguageMode(mode: LanguageMode): Promise<LanguageMode> {
  const next = languageModeFromValue(mode);
  await storageSet({ [LANGUAGE_SETTINGS_KEY]: next });
  return next;
}

export function languageModeFromStorageValue(value: unknown): LanguageMode {
  return languageModeFromValue(value);
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
