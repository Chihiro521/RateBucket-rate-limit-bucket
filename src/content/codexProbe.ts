const CODEX_ANALYTICS_URL =
  "https://chatgpt.com/codex/cloud/settings/analytics#usage";

export function probeCodexAnalyticsUsage(): () => void {
  const iframe = document.createElement("iframe");
  iframe.src = CODEX_ANALYTICS_URL;
  iframe.title = "Codex usage probe";
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.width = "1px";
  iframe.style.height = "1px";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  iframe.style.border = "0";
  iframe.style.left = "-9999px";
  iframe.style.top = "-9999px";

  document.documentElement.append(iframe);

  const timeoutId = window.setTimeout(() => {
    iframe.remove();
  }, 15_000);

  return () => {
    window.clearTimeout(timeoutId);
    iframe.remove();
  };
}
