import { UsageWidget } from "../src/content/widget";
import type { PlatformId } from "../src/platforms/types";
import { copy, isSiteLanguage, type SiteLanguage } from "./copy";
import { demoSnapshot, isPlatform, platforms } from "./demo-data";
import "./demo.css";

let platform: PlatformId = "chatgpt";
let language: SiteLanguage = "zh-CN";
let widget: UsageWidget | null = null;
let refreshed = false;
let refreshTimer: number | undefined;
let generation = 0;

function tellParent(event: "ready" | "configured" | "refreshed" | "language", extra: object = {}): void {
  if (window.parent !== window) window.parent.postMessage({ type: "ratebucket-demo", event, ...extra }, window.location.origin);
}

function updateCopy(): void {
  document.documentElement.lang = language;
  document.getElementById("mock-brand")!.textContent = platforms[platform].name;
  document.getElementById("sample-label")!.textContent = copy[language].sample;
  for (const [id, key] of [["mock-eyebrow", "mockEyebrow"], ["mock-title", "mockTitle"], ["mock-prompt", "mockPrompt"], ["mock-hint", "mockHint"]] as const) {
    document.getElementById(id)!.textContent = copy[language][key];
  }
}

function toggle(): void {
  const shadow = document.getElementById("ai-usage-floating-monitor")?.shadowRoot;
  const button = shadow?.querySelector<HTMLButtonElement>(".collapsed,.gpt-restore-chip") ??
    shadow?.querySelector<HTMLButtonElement>(".actions .icon-button:last-child");
  button?.click();
}

function refresh(): void {
  if (!widget || refreshTimer !== undefined) return;
  widget.setLoading(true);
  refreshTimer = window.setTimeout(() => {
    refreshTimer = undefined;
    refreshed = !refreshed;
    widget?.setSnapshot(demoSnapshot(platform, language, refreshed));
    widget?.setLoading(false);
    tellParent("refreshed");
  }, 450);
}

function mount(): void {
  generation += 1;
  const currentGeneration = generation;
  window.clearTimeout(refreshTimer);
  refreshTimer = undefined;
  widget?.destroy();
  widget = new UsageWidget(platform, refresh, { onLanguageModeSave: (mode) => {
    language = mode === "auto" ? (navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en") : mode;
    updateCopy();
    widget?.setSnapshot(demoSnapshot(platform, language, refreshed));
    tellParent("language", { language });
  } });
  widget.setLanguageMode(language);
  widget.mount();
  widget.setSnapshot(demoSnapshot(platform, language, refreshed));
  updateCopy();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (generation !== currentGeneration) return;
    toggle();
    tellParent("ready");
  }));
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent || event.origin !== window.location.origin || !event.data || typeof event.data !== "object") return;
  const data = event.data as Record<string, unknown>;
  if (data.type !== "ratebucket-site") return;
  if (data.action === "configure" && isPlatform(data.platform) && isSiteLanguage(data.language)) {
    const changedPlatform = data.platform !== platform;
    platform = data.platform;
    language = data.language;
    if (changedPlatform) { refreshed = false; mount(); }
    else { widget?.setLanguageMode(language); widget?.setSnapshot(demoSnapshot(platform, language, refreshed)); updateCopy(); tellParent("configured"); }
  } else if (data.action === "toggle") toggle();
  else if (data.action === "refresh") refresh();
  else if (data.action === "reset") { refreshed = false; mount(); }
});

window.addEventListener("pagehide", () => { generation += 1; window.clearTimeout(refreshTimer); widget?.destroy(); });
mount();
