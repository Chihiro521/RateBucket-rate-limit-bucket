import {
  DEFAULT_IP_RISK_PUBLIC_SETTINGS,
  type IpRiskPublicSettings,
  type IpRiskSettingsUpdate,
  type IpRiskState,
  type IpRiskStoredSettings,
  publicIpRiskSettings,
  sanitizeProxycheckApiKey
} from "../platforms/ipRisk";

export const IP_RISK_SETTINGS_KEY = "aiUsage:ipRisk:settings";
export const IP_RISK_STATE_KEY = "aiUsage:ipRisk:state";

export async function getStoredIpRiskSettings(): Promise<IpRiskStoredSettings> {
  const items = await storageGet(IP_RISK_SETTINGS_KEY);
  return storedIpRiskSettingsFromValue(items[IP_RISK_SETTINGS_KEY]);
}

export async function getIpRiskPublicSettings(): Promise<IpRiskPublicSettings> {
  return publicIpRiskSettings(await getStoredIpRiskSettings());
}

export async function saveIpRiskSettings(
  update: IpRiskSettingsUpdate
): Promise<IpRiskPublicSettings> {
  const existing = await getStoredIpRiskSettings();
  const next: IpRiskStoredSettings = {
    provider: "proxycheck",
    enabled: update.enabled,
    proxycheckApiKey: existing.proxycheckApiKey
  };

  const apiKey = sanitizeProxycheckApiKey(update.apiKey);
  if (apiKey) {
    next.proxycheckApiKey = apiKey;
  }
  if (update.clearApiKey) {
    delete next.proxycheckApiKey;
  }

  await storageSet({ [IP_RISK_SETTINGS_KEY]: next });
  return publicIpRiskSettings(next);
}

export async function getIpRiskState(): Promise<IpRiskState | null> {
  const items = await storageGet(IP_RISK_STATE_KEY);
  const state = items[IP_RISK_STATE_KEY];
  return isIpRiskState(state) ? state : null;
}

export function setIpRiskState(state: IpRiskState): Promise<void> {
  return storageSet({ [IP_RISK_STATE_KEY]: state });
}

export function publicSettingsFromStorageValue(
  value: unknown
): IpRiskPublicSettings {
  return publicIpRiskSettings(storedIpRiskSettingsFromValue(value));
}

export function ipRiskStateFromStorageValue(value: unknown): IpRiskState | null {
  return isIpRiskState(value) ? value : null;
}

function storedIpRiskSettingsFromValue(value: unknown): IpRiskStoredSettings {
  if (typeof value !== "object" || value === null) {
    return {
      provider: "proxycheck",
      enabled: DEFAULT_IP_RISK_PUBLIC_SETTINGS.enabled
    };
  }
  const record = value as Record<string, unknown>;
  const apiKey = sanitizeProxycheckApiKey(record.proxycheckApiKey);
  return {
    provider: "proxycheck",
    enabled: record.enabled === true,
    ...(apiKey ? { proxycheckApiKey: apiKey } : {})
  };
}

function isIpRiskState(value: unknown): value is IpRiskState {
  const candidate = value as IpRiskState;
  return (
    typeof value === "object" &&
    value !== null &&
    candidate.provider === "proxycheck" &&
    candidate.source === "proxycheck.io" &&
    typeof candidate.updatedAt === "number" &&
    typeof candidate.signals === "object" &&
    candidate.signals !== null
  );
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
