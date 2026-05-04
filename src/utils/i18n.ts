import type { IpRiskLabel } from "../platforms/ipRisk";
import type { UsageMeter } from "../platforms/types";
import { resolveResetMs } from "./time";

export type LanguageMode = "auto" | "zh-CN" | "en";
export type ResolvedLanguage = "zh-CN" | "en";

export const DEFAULT_LANGUAGE_MODE: LanguageMode = "auto";

const ZH_TEXT = {
  "action.closeSettings": "关闭设置",
  "action.collapsePanel": "折叠用量面板",
  "action.collapseWidget": "收起用量组件",
  "action.expandPanel": "展开用量面板",
  "action.hidePanel": "隐藏用量面板",
  "action.openUsage": "打开 {platform} 用量",
  "action.refreshUsage": "刷新用量",
  "action.restoreGptPanel": "恢复 GPT 用量面板",
  "action.settings": "设置",
  "action.toggleSecret": "显示或隐藏密钥",
  "gpt.alertCount": "{count} 项预警",
  "gpt.title": "GPT 用量",
  "ip.apiKeyLabel": "proxycheck.io API 密钥",
  "ip.check": "IP 检测",
  "ip.deleteKey": "删除密钥",
  "ip.enableProxycheck": "启用 proxycheck.io",
  "ip.enabledHelp": "proxycheck.io 密钥仅保存在本地，检测结果不代表 OpenAI 官方账号状态。",
  "ip.errorFallback": "检测失败",
  "ip.help": "密钥保存在 chrome.storage.local。检测会先临时获取当前公网 IP，再查询 proxycheck.io，不保存历史 IP。",
  "ip.keyPlaceholder": "输入 proxycheck.io API 密钥",
  "ip.newKeyPlaceholder": "输入新的 proxycheck.io API 密钥",
  "ip.noProxySignals": "未见明显代理信号",
  "ip.querying": "正在查询 proxycheck.io。",
  "ip.savedKeyPlaceholder": "已保存密钥，留空则不修改",
  "ip.source": "来源",
  "ip.disabledHelp": "可在设置中启用 proxycheck.io 作为第三方 IP 信誉检测源。",
  "ip.signal": "信号",
  "ip.status.checking": "检测中",
  "ip.status.disabled": "未启用",
  "ip.status.failed": "检测失败",
  "ip.status.missingKey": "未配置密钥",
  "ip.status.waiting": "等待检测",
  "language.auto": "跟随浏览器",
  "language.en": "English",
  "language.label": "语言",
  "language.zhCN": "简体中文",
  "meta.cacheSeconds": "缓存 {seconds}秒",
  "meta.loading": "加载中",
  "meta.neverUpdated": "尚未更新",
  "meta.updatedAt": "更新于 {age}",
  "meta.waitSeconds": "等待 {seconds}秒",
  "meter.unknown": "未知",
  "meter.used": "已用 {used}/{total}",
  "meter.usedPercent": "{percent}% 已用",
  "meter.remaining": "剩余 {remaining}",
  "meter.remainingPercent": "{percent}% 剩余",
  "model.label": "模型",
  "settings.checkNow": "立即检测",
  "settings.save": "保存",
  "settings.title": "设置",
  "sentinel.accountStatus": "账号状态",
  "sentinel.explanation": "说明：当前仅验证 PoW 难度，不判断模型 fallback。",
  "sentinel.gate": "发送门禁",
  "usage.empty": "暂无用量数据",
  "usage.networkRisk": "网络风险",
  "usage.title": "{platform} 用量"
} as const;

export type TextKey = keyof typeof ZH_TEXT;

const EN_TEXT: Record<TextKey, string> = {
  "action.closeSettings": "Close settings",
  "action.collapsePanel": "Collapse usage panel",
  "action.collapseWidget": "Collapse usage widget",
  "action.expandPanel": "Expand usage panel",
  "action.hidePanel": "Hide usage panel",
  "action.openUsage": "Open {platform} usage",
  "action.refreshUsage": "Refresh usage",
  "action.restoreGptPanel": "Restore GPT usage panel",
  "action.settings": "Settings",
  "action.toggleSecret": "Show or hide key",
  "gpt.alertCount": "{count} alerts",
  "gpt.title": "GPT Usage",
  "ip.apiKeyLabel": "proxycheck.io API key",
  "ip.check": "IP check",
  "ip.deleteKey": "Delete key",
  "ip.enableProxycheck": "Enable proxycheck.io",
  "ip.enabledHelp": "The proxycheck.io key is stored locally only. Results do not represent official OpenAI account status.",
  "ip.errorFallback": "Check failed",
  "ip.help": "The key is stored in chrome.storage.local. Checks temporarily fetch the current public IP, query proxycheck.io, and do not keep IP history.",
  "ip.keyPlaceholder": "Enter proxycheck.io API key",
  "ip.newKeyPlaceholder": "Enter a new proxycheck.io API key",
  "ip.noProxySignals": "No clear proxy signals",
  "ip.querying": "Querying proxycheck.io.",
  "ip.savedKeyPlaceholder": "Key saved. Leave blank to keep it",
  "ip.source": "Source",
  "ip.disabledHelp": "Enable proxycheck.io in settings as a third-party IP reputation source.",
  "ip.signal": "Signals",
  "ip.status.checking": "Checking",
  "ip.status.disabled": "Disabled",
  "ip.status.failed": "Check failed",
  "ip.status.missingKey": "Missing key",
  "ip.status.waiting": "Waiting to check",
  "language.auto": "Follow browser",
  "language.en": "English",
  "language.label": "Language",
  "language.zhCN": "Simplified Chinese",
  "meta.cacheSeconds": "Cached {seconds}s",
  "meta.loading": "Loading",
  "meta.neverUpdated": "Not updated yet",
  "meta.updatedAt": "Updated {age}",
  "meta.waitSeconds": "Wait {seconds}s",
  "meter.unknown": "Unknown",
  "meter.used": "Used {used}/{total}",
  "meter.usedPercent": "{percent}% used",
  "meter.remaining": "Remaining {remaining}",
  "meter.remainingPercent": "{percent}% remaining",
  "model.label": "Model",
  "settings.checkNow": "Check now",
  "settings.save": "Save",
  "settings.title": "Settings",
  "sentinel.accountStatus": "Account status",
  "sentinel.explanation": "Note: currently only validates PoW difficulty, not model fallback.",
  "sentinel.gate": "Send gate",
  "usage.empty": "No usage data yet",
  "usage.networkRisk": "Network risk",
  "usage.title": "{platform} Usage"
};

const TEXT: Record<ResolvedLanguage, Record<TextKey, string>> = {
  "zh-CN": ZH_TEXT,
  en: EN_TEXT
};

const GPT_SECTION_LABELS: Record<
  ResolvedLanguage,
  Record<"input" | "features" | "windows" | "codex" | "other", string>
> = {
  "zh-CN": {
    input: "输入与附件",
    features: "GPT 功能额度",
    windows: "用量窗口",
    codex: "余额 / Codex",
    other: "其他"
  },
  en: {
    input: "Input and attachments",
    features: "GPT feature limits",
    windows: "Usage windows",
    codex: "Balance / Codex",
    other: "Other"
  }
};

const SOURCE_LABELS: Record<ResolvedLanguage, Record<string, string>> = {
  "zh-CN": {
    api: "接口",
    intercepted: "捕获",
    estimate: "估算",
    unknown: "未知"
  },
  en: {
    api: "API",
    intercepted: "Captured",
    estimate: "Estimate",
    unknown: "Unknown"
  }
};

const CONFIDENCE_LABELS: Record<ResolvedLanguage, Record<string, string>> = {
  "zh-CN": {
    high: "高",
    medium: "中",
    low: "低"
  },
  en: {
    high: "High",
    medium: "Medium",
    low: "Low"
  }
};

const STATUS_LABELS: Record<ResolvedLanguage, Record<string, string>> = {
  "zh-CN": {
    ok: "正常",
    partial: "部分可用",
    unknown: "未知",
    error: "错误"
  },
  en: {
    ok: "OK",
    partial: "Partial",
    unknown: "Unknown",
    error: "Error"
  }
};

const RISK_LABELS: Record<ResolvedLanguage, Record<IpRiskLabel, string>> = {
  "zh-CN": {
    正常: "正常",
    偏高: "偏高",
    高: "高",
    严重: "严重",
    未知: "未知"
  },
  en: {
    正常: "Normal",
    偏高: "Elevated",
    高: "High",
    严重: "Severe",
    未知: "Unknown"
  }
};

const METER_LABELS_ZH: Record<string, string> = {
  "File Upload": "文件上传",
  "Paste Text To File": "粘贴文本转文件",
  Dictation: "听写",
  "Deep Research": "深度研究",
  "Image Generation": "图像生成",
  "Primary window": "主窗口",
  "Weekly window": "每周窗口",
  "Tasks rate limit": "任务限额",
  "Code Review": "代码审查",
  Credits: "余额",
  "Credits (unlimited)": "余额（无限）"
};

export function isLanguageMode(value: unknown): value is LanguageMode {
  return value === "auto" || value === "zh-CN" || value === "en";
}

export function languageModeFromValue(value: unknown): LanguageMode {
  return isLanguageMode(value) ? value : DEFAULT_LANGUAGE_MODE;
}

export function resolveLanguage(
  mode: LanguageMode,
  browserLanguages = browserLanguageCandidates()
): ResolvedLanguage {
  if (mode !== "auto") {
    return mode;
  }
  for (const language of browserLanguages) {
    const normalized = language.trim().toLowerCase();
    if (normalized.startsWith("zh")) {
      return "zh-CN";
    }
    if (normalized.startsWith("en")) {
      return "en";
    }
  }
  return "en";
}

export function t(
  language: ResolvedLanguage,
  key: TextKey,
  params: Record<string, string | number> = {}
): string {
  return TEXT[language][key].replace(/\{(\w+)\}/g, (_, name: string) =>
    params[name] === undefined ? "" : String(params[name])
  );
}

export function formatAgeLocalized(
  language: ResolvedLanguage,
  timestamp: number,
  now = Date.now()
): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 5) {
    return language === "zh-CN" ? "刚刚" : "just now";
  }
  if (seconds < 60) {
    return language === "zh-CN" ? `${seconds}秒前` : `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return language === "zh-CN" ? `${minutes}分钟前` : `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return language === "zh-CN" ? `${hours}小时前` : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return language === "zh-CN" ? `${days}天前` : `${days}d ago`;
}

export function formatResetLocalized(
  language: ResolvedLanguage,
  meter: UsageMeter,
  now = Date.now()
): string {
  const resetMs = resolveResetMs(meter, now);
  if (resetMs === null) {
    return "";
  }
  const seconds = Math.max(0, Math.floor((resetMs - now) / 1000));
  if (seconds < 60) {
    return language === "zh-CN" ? `${seconds}秒` : `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return language === "zh-CN" ? `${minutes}分钟` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return language === "zh-CN" ? `${hours}小时` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return language === "zh-CN" ? `${days}天` : `${days}d`;
}

export function formatMeterValueLocalized(
  language: ResolvedLanguage,
  meter: UsageMeter
): string {
  if (typeof meter.remainingPercent === "number") {
    return t(language, "meter.remainingPercent", {
      percent: Math.round(meter.remainingPercent)
    });
  }
  if (typeof meter.remaining === "number" && typeof meter.total === "number") {
    return `${meter.remaining}/${meter.total}`;
  }
  if (typeof meter.remaining === "number") {
    return t(language, "meter.remaining", { remaining: meter.remaining });
  }
  if (typeof meter.used === "number" && typeof meter.total === "number") {
    return t(language, "meter.used", {
      used: meter.used,
      total: meter.total
    });
  }
  if (typeof meter.usedPercent === "number") {
    return t(language, "meter.usedPercent", {
      percent: Math.round(meter.usedPercent)
    });
  }
  return t(language, "meter.unknown");
}

export function formatMeterLabelLocalized(
  language: ResolvedLanguage,
  meter: UsageMeter
): string {
  if (language === "en") {
    return meter.label;
  }
  const direct = METER_LABELS_ZH[meter.label];
  if (direct) {
    return direct;
  }
  return meter.label
    .replace(/\bquery limit\b/gi, "查询额度")
    .replace(/\btoken limit\b/gi, "token 额度")
    .replace(/\bLow \/ Fast \/ Normal\b/g, "低 / 快速 / 普通")
    .replace(/\bHigh \/ Thinking \/ Expert\b/g, "高 / 思考 / 专家")
    .replace(/\bCodex usage\b/gi, "Codex 用量")
    .replace(/\bPrimary window\b/gi, "主窗口")
    .replace(/\bWeekly window\b/gi, "每周窗口")
    .replace(/\b5[- ]?hour\b/gi, "5 小时")
    .replace(/\bweekly\b/gi, "每周")
    .replace(/\busage limit\b/gi, "使用限额")
    .replace(/\brate limit\b/gi, "使用限额");
}

export function formatGptSectionLabelLocalized(
  language: ResolvedLanguage,
  section: "input" | "features" | "windows" | "codex" | "other"
): string {
  return GPT_SECTION_LABELS[language][section];
}

export function formatSourceLabelLocalized(
  language: ResolvedLanguage,
  source: string
): string {
  return SOURCE_LABELS[language][source] ?? source;
}

export function formatConfidenceLabelLocalized(
  language: ResolvedLanguage,
  confidence: string
): string {
  return CONFIDENCE_LABELS[language][confidence] ?? confidence;
}

export function formatStatusLabelLocalized(
  language: ResolvedLanguage,
  status: string
): string {
  return STATUS_LABELS[language][status] ?? status;
}

export function formatRiskLabelLocalized(
  language: ResolvedLanguage,
  label: IpRiskLabel
): string {
  return RISK_LABELS[language][label] ?? label;
}

function browserLanguageCandidates(): string[] {
  if (typeof navigator === "undefined") {
    return [];
  }
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return [...navigator.languages];
  }
  return navigator.language ? [navigator.language] : [];
}
