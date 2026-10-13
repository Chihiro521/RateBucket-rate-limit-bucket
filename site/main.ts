import { copy, initialLanguage, isSiteLanguage, type CopyKey, type SiteLanguage } from "./copy";
import { isPlatform, platforms } from "./demo-data";
import type { PlatformId } from "../src/platforms/types";
import "./styles.css";

const languageKey = "ratebucket-site-language";
let savedLanguage: string | null = null;
try { savedLanguage = localStorage.getItem(languageKey); } catch { /* Browser storage may be unavailable. */ }
let language = initialLanguage(navigator.languages, savedLanguage);
let platform: PlatformId = "chatgpt";
let ready = false;
let refreshed = false;
const frame = document.querySelector<HTMLIFrameElement>("#demo-frame")!;
const status = document.querySelector<HTMLElement>("#demo-status")!;
const error = document.querySelector<HTMLElement>("#demo-error")!;
let loadingTimer: number;

function send(action: string): void {
  frame.contentWindow?.postMessage({ type: "ratebucket-site", action, platform, language }, window.location.origin);
}

function updatePlatform(): void {
  document.querySelector<HTMLElement>("#platform-title")!.textContent = platforms[platform].name;
  document.querySelector<HTMLElement>("#platform-description")!.textContent = copy[language][platforms[platform].description];
  document.querySelector<HTMLElement>("#demo-address")!.textContent = platforms[platform].domain;
  document.querySelector("#demo-panel")!.setAttribute("aria-labelledby", `tab-${platform}`);
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-platform]")) {
    const selected = button.dataset.platform === platform;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
}

function applyLanguage(next: SiteLanguage, persist = false): void {
  language = next;
  if (persist) { try { localStorage.setItem(languageKey, language); } catch { /* Keep the current selection in memory. */ } }
  document.documentElement.lang = language;
  for (const [attribute, target] of [["data-i18n", "text"], ["data-i18n-alt", "alt"], ["data-i18n-title", "title"], ["data-i18n-aria", "aria-label"]] as const) {
    for (const element of document.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
      const key = element.getAttribute(attribute) as CopyKey;
      if (target === "text") element.textContent = copy[language][key];
      else element.setAttribute(target, copy[language][key]);
    }
  }
  document.title = copy[language].pageTitle;
  document.querySelector('meta[name="description"]')!.setAttribute("content", copy[language].pageDescription);
  document.querySelector('meta[property="og:title"]')!.setAttribute("content", copy[language].pageTitle);
  document.querySelector('meta[property="og:description"]')!.setAttribute("content", copy[language].pageDescription);
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-language]")) {
    button.setAttribute("aria-pressed", String(button.dataset.language === language));
  }
  updatePlatform();
  status.textContent = copy[language][ready ? refreshed ? "demoRefreshed" : "demoReady" : "demoLoading"];
  if (ready) send("configure");
}

function startLoading(): void {
  ready = false;
  error.hidden = true;
  frame.setAttribute("aria-busy", "true");
  status.textContent = copy[language].demoLoading;
  for (const button of document.querySelectorAll<HTMLButtonElement>("#toggle-demo,#refresh-demo,#reset-demo")) button.disabled = true;
  window.clearTimeout(loadingTimer);
  loadingTimer = window.setTimeout(() => { if (!ready) { error.hidden = false; status.textContent = copy[language].demoError; } }, 10_000);
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-language]")) {
  button.addEventListener("click", () => { if (isSiteLanguage(button.dataset.language)) applyLanguage(button.dataset.language, true); });
}

const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-platform]"));
function choosePlatform(button: HTMLButtonElement): void {
  if (!isPlatform(button.dataset.platform)) return;
  platform = button.dataset.platform;
  refreshed = false;
  updatePlatform();
  status.textContent = copy[language][ready ? "demoReady" : "demoLoading"];
  if (ready) send("configure");
}
tabs.forEach((button, index) => {
  button.addEventListener("click", () => choosePlatform(button));
  button.addEventListener("keydown", (event) => {
    let nextIndex: number;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    choosePlatform(tabs[nextIndex]);
    tabs[nextIndex].focus();
    tabs[nextIndex].scrollIntoView({ block: "nearest", inline: "nearest" });
  });
});

document.querySelector("#toggle-demo")!.addEventListener("click", () => send("toggle"));
document.querySelector("#refresh-demo")!.addEventListener("click", () => send("refresh"));
document.querySelector("#reset-demo")!.addEventListener("click", () => { refreshed = false; status.textContent = copy[language].demoReady; send("reset"); });
document.querySelector("#reload-demo")!.addEventListener("click", () => { startLoading(); frame.src = new URL("./demo.html", window.location.href).href; });
frame.addEventListener("load", () => send("configure"));
window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== frame.contentWindow || event.origin !== window.location.origin || !event.data || typeof event.data !== "object") return;
  const data = event.data as Record<string, unknown>;
  if (data.type !== "ratebucket-demo") return;
  if (data.event === "ready" || data.event === "configured") {
    ready = true;
    error.hidden = true;
    frame.setAttribute("aria-busy", "false");
    window.clearTimeout(loadingTimer);
    for (const button of document.querySelectorAll<HTMLButtonElement>("#toggle-demo,#refresh-demo,#reset-demo")) button.disabled = false;
    status.textContent = copy[language].demoReady;
    if (data.event === "ready") send("configure");
  } else if (data.event === "refreshed") {
    refreshed = true;
    status.textContent = copy[language].demoRefreshed;
  } else if (data.event === "language" && isSiteLanguage(data.language)) applyLanguage(data.language, true);
});

document.querySelector<HTMLButtonElement>("#copy-extensions")!.addEventListener("click", async () => {
  const button = document.querySelector<HTMLButtonElement>("#copy-extensions")!;
  let message: string;
  try { await navigator.clipboard.writeText("chrome://extensions"); message = copy[language].copied; }
  catch { message = copy[language].copyFailed; }
  document.querySelector<HTMLElement>("#copy-status")!.textContent = message;
  button.title = message;
  window.setTimeout(() => { button.title = copy[language].copyAddress; }, 2500);
});

const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
let revealObserver: IntersectionObserver | null = null;
function setMotion(): void {
  revealObserver?.disconnect();
  document.documentElement.classList.toggle("js-motion", !motion.matches);
  if (!motion.matches) {
    revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver?.unobserve(entry.target);
      }
    }, { threshold: 0.08, rootMargin: "0px 0px 50px 0px" });
    document.querySelectorAll(".reveal").forEach((element) => revealObserver!.observe(element));
  }
}
motion.addEventListener("change", setMotion);
document.querySelector("#year")!.textContent = String(new Date().getFullYear());
startLoading();
applyLanguage(language);
setMotion();
send("configure");
