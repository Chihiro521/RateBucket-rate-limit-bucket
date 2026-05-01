import type { PlatformId, UsageMeter, UsageSnapshot } from "../platforms/types";
import { formatAge, formatReset } from "../utils/time";
import { WIDGET_CSS } from "./styles";

type RefreshHandler = () => void;
type ChipEdge = "left" | "right" | "top" | "bottom";

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
  private hidden = false;
  private chipPosition = { edge: "right" as ChipEdge, offset: 96 };
  private loading = false;
  private snapshot: UsageSnapshot | null = null;
  private backoffUntil = 0;
  private readonly timerId: number;

  constructor(
    private readonly platform: PlatformId,
    private readonly onRefresh: RefreshHandler
  ) {
    this.expanded = false;
    this.hidden = platform === "chatgpt";
    this.host.dataset.platform = platform;
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
    if (this.hidden) {
      this.root.replaceChildren(
        this.platform === "chatgpt" ? this.renderChatGptRestoreChip() : emptyNode()
      );
      return;
    }
    if (this.platform === "chatgpt") {
      if (!this.hidden) {
        this.resetPanelPosition();
      }
      this.root.replaceChildren(
        this.expanded ? this.renderChatGptPanel() : this.renderChatGptCollapsed()
      );
      return;
    }
    this.root.replaceChildren(
      this.expanded ? this.renderPanel() : this.renderCollapsed()
    );
  }

  private renderChatGptRestoreChip(): HTMLElement {
    const button = el("button", "gpt-restore-chip");
    button.type = "button";
    this.applyChipPosition();
    button.setAttribute("aria-label", "Restore GPT usage panel");
    this.installChipDrag(button);
    button.append(
      el("span", `status-dot status-${this.snapshot?.status ?? "unknown"}`),
      node("span", "collapsed-main", [
        textEl("span", "platform", "GPT"),
        textEl("span", "primary", this.primaryValue())
      ])
    );
    return button;
  }

  private applyChipPosition(): void {
    const margin = 8;
    this.host.style.top = "";
    this.host.style.right = "";
    this.host.style.bottom = "";
    this.host.style.left = "";
    this.host.style.transform = "none";

    if (this.chipPosition.edge === "left") {
      this.host.style.left = `${margin}px`;
      this.host.style.top = `${this.chipPosition.offset}px`;
      return;
    }
    if (this.chipPosition.edge === "right") {
      this.host.style.right = `${margin}px`;
      this.host.style.top = `${this.chipPosition.offset}px`;
      return;
    }
    if (this.chipPosition.edge === "top") {
      this.host.style.top = `${margin}px`;
      this.host.style.left = `${this.chipPosition.offset}px`;
      return;
    }
    this.host.style.bottom = `${margin}px`;
    this.host.style.left = `${this.chipPosition.offset}px`;
  }

  private resetPanelPosition(): void {
    if (this.platform !== "chatgpt") {
      return;
    }
    this.host.style.top = "";
    this.host.style.right = "";
    this.host.style.bottom = "";
    this.host.style.left = "";
    this.host.style.transform = "";
  }

  private installChipDrag(button: HTMLButtonElement): void {
    let startX = 0;
    let startY = 0;
    let moved = false;

    const onPointerMove = (event: PointerEvent): void => {
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      if (!moved && Math.hypot(deltaX, deltaY) < 4) {
        return;
      }
      moved = true;
      this.updateChipPositionFromPoint(event.clientX, event.clientY);
      this.applyChipPosition();
    };

    const onPointerUp = (event: PointerEvent): void => {
      button.releasePointerCapture(event.pointerId);
      button.removeEventListener("pointermove", onPointerMove);
      button.removeEventListener("pointerup", onPointerUp);
      button.removeEventListener("pointercancel", onPointerUp);
      if (!moved) {
        this.hidden = false;
        this.expanded = true;
        this.resetPanelPosition();
        this.render();
      }
    };

    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      startX = event.clientX;
      startY = event.clientY;
      moved = false;
      button.setPointerCapture(event.pointerId);
      button.addEventListener("pointermove", onPointerMove);
      button.addEventListener("pointerup", onPointerUp);
      button.addEventListener("pointercancel", onPointerUp);
    });
  }

  private updateChipPositionFromPoint(clientX: number, clientY: number): void {
    const margin = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const distances = {
      left: clientX,
      right: viewportWidth - clientX,
      top: clientY,
      bottom: viewportHeight - clientY
    };
    const edge = (Object.entries(distances).sort((a, b) => a[1] - b[1])[0][0] ??
      "right") as ChipEdge;

    if (edge === "left" || edge === "right") {
      this.chipPosition = {
        edge,
        offset: clamp(clientY - 24, margin, viewportHeight - 56)
      };
      return;
    }
    this.chipPosition = {
      edge,
      offset: clamp(clientX - 44, margin, viewportWidth - 96)
    };
  }

  private renderChatGptCollapsed(): HTMLElement {
    const panel = el("section", "gpt-collapsed-panel");
    const title = textEl("div", "gpt-title", "GPT usage");
    const summary = textEl("div", "gpt-collapsed-summary", this.criticalSummary());
    const actions = el("div", "gpt-actions");

    const refresh = this.renderActionButton(
      this.loading ? "..." : "↻",
      "Refresh usage",
      () => this.onRefresh()
    );
    refresh.disabled = this.loading || this.backoffRemainingMs() > 0;

    const expand = this.renderActionButton("+", "Expand usage panel", () => {
      this.expanded = true;
      this.render();
    });
    const close = this.renderActionButton("×", "Hide usage panel", () => {
      this.hidden = true;
      this.render();
    });

    actions.append(refresh, expand, close);
    panel.append(title, summary, actions);
    return panel;
  }

  private renderChatGptPanel(): HTMLElement {
    const panel = el("section", "gpt-panel");
    panel.append(
      this.renderChatGptHeader(),
      this.renderMeta(),
      this.renderChatGptContent()
    );
    return panel;
  }

  private renderChatGptHeader(): HTMLElement {
    const header = el("div", "header gpt-header");
    const title = textEl("div", "title gpt-title", "GPT usage");
    const right = el("div", "gpt-header-right");
    right.append(textEl("span", "gpt-alerts", `${this.alertCount()} alerts`));

    const actions = el("div", "actions gpt-actions");
    const refresh = this.renderActionButton(
      this.loading ? "..." : "↻",
      "Refresh usage",
      () => this.onRefresh()
    );
    refresh.disabled = this.loading || this.backoffRemainingMs() > 0;

    const collapse = this.renderActionButton("−", "Collapse usage panel", () => {
      this.expanded = false;
      this.render();
    });
    const close = this.renderActionButton("×", "Hide usage panel", () => {
      this.hidden = true;
      this.render();
    });

    actions.append(refresh, collapse, close);
    right.append(actions);
    header.append(title, right);
    return header;
  }

  private renderChatGptContent(): HTMLElement {
    const content = el("div", "content gpt-content");
    if (this.snapshot?.errorMessage) {
      content.append(textEl("div", "error", this.snapshot.errorMessage));
    }
    const meters = this.chatGptMeters();
    if (meters.length === 0) {
      content.append(textEl("div", "empty", "No usage data available yet"));
      return content;
    }
    for (const meter of meters) {
      content.append(this.renderMeter(meter));
    }
    return content;
  }

  private renderActionButton(
    text: string,
    label: string,
    onClick: () => void
  ): HTMLButtonElement {
    const button = textEl("button", "icon-button", text);
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.addEventListener("click", onClick);
    return button;
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

  private alertCount(): number {
    return this.chatGptMeters().filter(isAlertMeter).length;
  }

  private criticalSummary(): string {
    const meters = this.chatGptMeters();
    const alert = meters.find((meter) => typeof meter.remaining === "number" && meter.remaining <= 0)
      ?? meters
        .filter((meter) => typeof meter.usedPercent === "number")
        .sort((a, b) => (b.usedPercent ?? 0) - (a.usedPercent ?? 0))[0]
      ?? meters
        .filter((meter) => typeof meter.remaining === "number")
        .sort((a, b) => (a.remaining ?? 0) - (b.remaining ?? 0))[0];
    if (!alert) {
      return this.snapshot?.status ?? "unknown";
    }
    if (typeof alert.usedPercent === "number") {
      return `${shortLabel(alert.label)} ${Math.round(alert.usedPercent)}%`;
    }
    if (typeof alert.remaining === "number") {
      return `${shortLabel(alert.label)} ${alert.remaining} left`;
    }
    return shortLabel(alert.label);
  }

  private chatGptMeters(): UsageMeter[] {
    const meters = [...(this.snapshot?.meters ?? [])];
    return meters.sort((a, b) => chatGptMeterPriority(a) - chatGptMeterPriority(b));
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isAlertMeter(meter: UsageMeter): boolean {
  if (typeof meter.remaining === "number" && meter.remaining <= 0) {
    return true;
  }
  if (typeof meter.usedPercent === "number" && meter.usedPercent >= 95) {
    return true;
  }
  return false;
}

function chatGptMeterPriority(meter: UsageMeter): number {
  const key = meter.key.toLowerCase();
  const label = meter.label.toLowerCase();
  if (key.startsWith("limits_progress:file_upload")) {
    return 10;
  }
  if (key.startsWith("limits_progress:") || meter.rawKind === "limits_progress") {
    return 20;
  }
  if (label.includes("primary window")) {
    return 40;
  }
  if (label.includes("weekly window")) {
    return 41;
  }
  if (label.includes("credits")) {
    return 42;
  }
  if (key.includes("codex") || meter.rawKind === "codex.settings.usage") {
    return 50;
  }
  return 80;
}

function shortLabel(label: string): string {
  return label
    .replace(/\bwindow\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18);
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

function emptyNode(): HTMLElement {
  return document.createElement("span");
}
