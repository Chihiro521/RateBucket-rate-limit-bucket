import type { PlatformId, UsageMeter, UsageSnapshot } from "../platforms/types";
import { formatAge, formatReset } from "../utils/time";
import { WIDGET_CSS } from "./styles";

type RefreshHandler = () => void;

const PLATFORM_LABEL: Record<PlatformId, string> = {
  grok: "Grok",
  claude: "Claude",
  chatgpt: "GPT"
};

export class UsageWidget {
  private readonly host = document.createElement("div");
  private readonly shadow = this.host.attachShadow({ mode: "open" });
  private readonly root = document.createElement("div");
  private expanded = false;
  private loading = false;
  private snapshot: UsageSnapshot | null = null;
  private backoffUntil = 0;
  private readonly timerId: number;

  constructor(
    private readonly platform: PlatformId,
    private readonly onRefresh: RefreshHandler
  ) {
    const style = document.createElement("style");
    style.textContent = WIDGET_CSS;
    this.shadow.append(style, this.root);
    this.timerId = window.setInterval(() => this.render(), 15_000);
  }

  mount(): void {
    document.documentElement.append(this.host);
    this.render();
  }

  destroy(): void {
    window.clearInterval(this.timerId);
    this.host.remove();
  }

  setSnapshot(snapshot: UsageSnapshot | null): void {
    this.snapshot = snapshot;
    this.render();
  }

  setLoading(value: boolean): void {
    this.loading = value;
    this.render();
  }

  setBackoffUntil(value: number): void {
    this.backoffUntil = value;
    this.render();
  }

  private render(): void {
    this.root.replaceChildren(
      this.expanded ? this.renderPanel() : this.renderCollapsed()
    );
  }

  private renderCollapsed(): HTMLElement {
    const button = el("button", "collapsed");
    button.type = "button";
    button.setAttribute("aria-label", `Open ${PLATFORM_LABEL[this.platform]} usage`);
    button.addEventListener("click", () => {
      this.expanded = true;
      this.render();
    });

    button.append(
      el("span", `status-dot status-${this.snapshot?.status ?? "unknown"}`),
      node("span", "collapsed-main", [
        textEl("span", "platform", PLATFORM_LABEL[this.platform]),
        textEl("span", "primary", this.primaryValue())
      ])
    );
    return button;
  }

  private renderPanel(): HTMLElement {
    const panel = el("section", "panel");
    panel.append(this.renderHeader(), this.renderMeta(), this.renderContent());
    return panel;
  }

  private renderHeader(): HTMLElement {
    const header = el("div", "header");
    const title = textEl("div", "title", `${PLATFORM_LABEL[this.platform]} usage`);
    const actions = el("div", "actions");

    const refresh = textEl("button", "icon-button", this.loading ? "..." : "↻");
    refresh.type = "button";
    refresh.setAttribute("aria-label", "Refresh usage");
    refresh.title = "Refresh usage";
    refresh.disabled = this.loading || this.backoffRemainingMs() > 0;
    refresh.addEventListener("click", this.onRefresh);

    const close = textEl("button", "icon-button", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Collapse usage widget");
    close.title = "Collapse";
    close.addEventListener("click", () => {
      this.expanded = false;
      this.render();
    });

    actions.append(refresh, close);
    header.append(title, actions);
    return header;
  }

  private renderMeta(): HTMLElement {
    const meta = el("div", "meta");
    const updated = this.snapshot
      ? `updated ${formatAge(this.snapshot.updatedAt)}`
      : "not updated";
    const right =
      this.backoffRemainingMs() > 0
        ? `wait ${Math.ceil(this.backoffRemainingMs() / 1000)}s`
        : this.snapshot?.cacheAgeMs !== undefined
          ? `cache ${Math.floor(this.snapshot.cacheAgeMs / 1000)}s`
          : this.loading
            ? "loading"
            : "";
    meta.append(textEl("span", "", updated), textEl("span", "", right));
    return meta;
  }

  private renderContent(): HTMLElement {
    const content = el("div", "content");
    if (this.snapshot?.errorMessage) {
      content.append(textEl("div", "error", this.snapshot.errorMessage));
    }
    const meters = this.snapshot?.meters ?? [];
    if (meters.length === 0) {
      content.append(textEl("div", "empty", "No usage data available yet"));
      return content;
    }
    for (const meter of meters) {
      content.append(this.renderMeter(meter));
    }
    return content;
  }

  private renderMeter(meter: UsageMeter): HTMLElement {
    const row = el("div", "meter");
    const top = el("div", "meter-top");
    top.append(
      textEl("div", "meter-label", meter.label),
      textEl("div", "meter-value", formatMeterValue(meter))
    );

    const progress = meterProgress(meter);
    const bar = el("div", "bar");
    const fill = el("div", "bar-fill");
    fill.style.width = `${progress}%`;
    bar.append(fill);

    const bottom = el("div", "meter-bottom");
    const age = meter.observedAt ? ` · ${formatAge(meter.observedAt)}` : "";
    bottom.append(
      textEl("span", "badge", `${meter.source} · ${meter.confidence}${age}`),
      textEl("span", "", formatReset(meter))
    );

    row.append(top, bar, bottom);
    return row;
  }

  private primaryValue(): string {
    const meters = this.snapshot?.meters ?? [];
    const byRemaining = meters
      .filter((meter) => typeof meter.remaining === "number")
      .sort((a, b) => (a.remaining ?? 0) - (b.remaining ?? 0))[0];
    if (byRemaining?.remaining !== undefined && byRemaining.remaining !== null) {
      return `${byRemaining.remaining}`;
    }
    const byPercent = meters.find((meter) => typeof meter.usedPercent === "number");
    if (byPercent?.usedPercent !== undefined && byPercent.usedPercent !== null) {
      return `${Math.round(byPercent.usedPercent)}%`;
    }
    return "?";
  }

  private backoffRemainingMs(): number {
    return Math.max(0, this.backoffUntil - Date.now());
  }
}

function formatMeterValue(meter: UsageMeter): string {
  if (typeof meter.remaining === "number" && typeof meter.total === "number") {
    return `${meter.remaining}/${meter.total}`;
  }
  if (typeof meter.remaining === "number") {
    return `${meter.remaining} left`;
  }
  if (typeof meter.used === "number" && typeof meter.total === "number") {
    return `${meter.used}/${meter.total} used`;
  }
  if (typeof meter.usedPercent === "number") {
    return `${Math.round(meter.usedPercent)}% used`;
  }
  return "unknown";
}

function meterProgress(meter: UsageMeter): number {
  if (typeof meter.usedPercent === "number") {
    return clampPercent(meter.usedPercent);
  }
  if (
    typeof meter.remaining === "number" &&
    typeof meter.total === "number" &&
    meter.total > 0
  ) {
    return clampPercent(((meter.total - meter.remaining) / meter.total) * 100);
  }
  return 0;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function el<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  return element;
}

function textEl<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text: string
): HTMLElementTagNameMap[K] {
  const element = el(tagName, className);
  element.textContent = text;
  return element;
}

function node<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  children: Node[]
): HTMLElementTagNameMap[K] {
  const element = el(tagName, className);
  element.append(...children);
  return element;
}
