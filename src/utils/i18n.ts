import type { UsageMeter } from "../platforms/types";
import { resolveResetMs } from "./time";

export type LanguageMode = "auto" | "zh-CN" | "en";
export type ResolvedLanguage = "zh-CN" | "en";

export const DEFAULT_LANGUAGE_MODE: LanguageMode = "auto";

const ZH_TEXT = {
  "action.closeSettings": "关闭设置",
  "action.collapseWidget": "收起用量组件",
  "action.hidePanel": "隐藏用量面板",
  "action.openUsage": "打开 {platform} 用量",
  "action.refreshUsage": "刷新用量",
  "action.restoreGptPanel": "恢复 GPT 用量面板",
  "action.settings": "设置",
  "gpt.alertCount": "{count} 项预警",
  "gpt.title": "GPT 用量",
  "language.auto": "跟随浏览器",
  "language.en": "English",
  "language.label": "语言",
  "language.zhCN": "简体中文",
  "meta.cacheSeconds": "缓存 {seconds}秒",
  "meta.checkedAt": "最近查询 {age}",
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
  "settings.save": "保存",
  "settings.title": "设置",
  "usage.empty": "暂无用量数据",
  "usage.title": "{platform} 用量"
} as const;

export type TextKey = keyof typeof ZH_TEXT;

const EN_TEXT: Record<TextKey, string> = {
  "action.closeSettings": "Close settings",
  "action.collapseWidget": "Collapse usage widget",
  "action.hidePanel": "Hide usage panel",
  "action.openUsage": "Open {platform} usage",
  "action.refreshUsage": "Refresh usage",
  "action.restoreGptPanel": "Restore GPT usage panel",
  "action.settings": "Settings",
  "gpt.alertCount": "{count} alerts",
  "gpt.title": "GPT Usage",
  "language.auto": "Follow browser",
  "language.en": "English",
  "language.label": "Language",
  "language.zhCN": "Simplified Chinese",
  "meta.cacheSeconds": "Cached {seconds}s",
  "meta.checkedAt": "Queried {age}",
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
  "settings.save": "Save",
  "settings.title": "Settings",
  "usage.empty": "No usage data yet",
  "usage.title": "{platform} Usage"
};

const TEXT: Record<ResolvedLanguage, Record<TextKey, string>> = {
  "zh-CN": ZH_TEXT,
  en: EN_TEXT
};

const GPT_SECTION_LABELS: Record<
  ResolvedLanguage,
  Record<"subscription" | "input" | "features" | "windows" | "codex" | "other", string>
> = {
  "zh-CN": {
    subscription: "订阅",
    input: "输入与附件",
    features: "GPT 功能额度",
    windows: "用量窗口",
    codex: "余额 / Codex",
    other: "其他"
  },
  en: {
    subscription: "Subscription",
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

const METER_LABELS_ZH: Record<string, string> = {
  "Library storage": "文件库空间",
  "Available resets": "可用重置次数",
  "File Upload": "文件上传",
  "Paste Text To File": "粘贴文本转文件",
  Dictation: "听写",
  "Deep Research": "深度研究",
  "Image Generation": "图像生成",
  "Computer Control": "电脑操控",
  "Computer Use": "电脑操控",
  "Reasoning Quota": "思考额度",
  "Primary window": "主窗口",
  "Secondary window": "次窗口",
  "5-hour window": "5 小时窗口",
  "Weekly window": "每周窗口",
  "Additional Primary window": "额外主窗口",
  "Additional Weekly window": "额外每周窗口",
  "ChatGPT subscription": "ChatGPT 订阅",
  "Current Grok limit": "当前 Grok 限额",
  "Weekly Grok limit": "每周 Grok 限额",
  "Monthly Grok limit": "每月 Grok 限额",
  Chat: "聊天",
  "Grok Build": "Grok Build",
  API: "API",
  Build: "Build",
  Voice: "Voice",
  "Tasks rate limit": "任务限额",
  "Code Review": "代码审查",
  Credits: "余额",
  "Credits (unlimited)": "余额（无限）",
  "Gemini 5h": "Gemini 5 小时",
  "Gemini weekly": "Gemini 每周",
  Pro: "Pro",
  Labs: "Labs",
  "Agentic Research": "智能体研究",
  "Free queries": "免费查询"
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
  if (hours < 24) {
    const remainingMinutes = minutes % 60;
    if (remainingMinutes > 0) {
      return language === "zh-CN"
        ? `${hours}小时 ${remainingMinutes}分钟`
        : `${hours}h ${remainingMinutes}m`;
    }
    return language === "zh-CN" ? `${hours}小时` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (remainingHours > 0) {
    return language === "zh-CN"
      ? `${days}天 ${remainingHours}小时`
      : `${days}d ${remainingHours}h`;
  }
  return language === "zh-CN" ? `${days}天` : `${days}d`;
}

export function formatSubscriptionExpiryLocalized(
  language: ResolvedLanguage,
  meter: UsageMeter
): string {
  const resetMs = resolveResetMs(meter);
  if (resetMs === null) {
    return "";
  }
  const date = new Date(resetMs);
  const exact = [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate())
  ].join("-") + ` ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(
    date.getSeconds()
  )}`;
  const verb =
    meter.requestKind === "renews"
      ? language === "zh-CN"
        ? "续订"
        : "Renews"
      : language === "zh-CN"
        ? "到期"
        : "Expires";
  return `${verb} ${exact}`;
}

export function formatMeterValueLocalized(
  language: ResolvedLanguage,
  meter: UsageMeter
): string {
  if (meter.quotaState === "blocked") return language === "zh-CN" ? "已达上限" : "Limit reached";
  if (meter.unit === "bytes") {
    const gib = (n: number): string => (n / 1073741824).toLocaleString(language, { maximumFractionDigits: 2 });
    return typeof meter.remaining === "number" ? (language === "zh-CN" ? "剩余 " : "Remaining ") + gib(meter.remaining) + " GiB" : t(language, "meter.unknown");
  }
  if (meter.label === "Credits (unlimited)") return language === "zh-CN" ? "无限" : "Unlimited";
  if (meter.rawKind === "chatgpt.subscription") {
    return formatSubscriptionRemainingLocalized(language, meter);
  }
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

function formatSubscriptionRemainingLocalized(
  language: ResolvedLanguage,
  meter: UsageMeter,
  now = Date.now()
): string {
  const resetMs = resolveResetMs(meter, now);
  if (resetMs === null) {
    return t(language, "meter.unknown");
  }
  const seconds = Math.max(0, Math.floor((resetMs - now) / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (language === "zh-CN") {
    if (days > 0) {
      return `剩余 ${days}天 ${hours}小时 ${minutes}分钟`;
    }
    if (hours > 0) {
      return `剩余 ${hours}小时 ${minutes}分钟`;
    }
    return `剩余 ${minutes}分钟`;
  }
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m left`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m left`;
  }
  return `${minutes}m left`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
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
  section: "subscription" | "input" | "features" | "windows" | "codex" | "other"
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

function browserLanguageCandidates(): string[] {
  if (typeof navigator === "undefined") {
    return [];
  }
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return [...navigator.languages];
  }
  return navigator.language ? [navigator.language] : [];
}
