import type { PlatformId, UsageMeter, UsageSnapshot } from "../platforms/types";
import {
  DEFAULT_LANGUAGE_MODE,
  formatAgeLocalized,
  formatConfidenceLabelLocalized,
  formatGptSectionLabelLocalized,
  formatMeterLabelLocalized,
  formatMeterValueLocalized,
  formatResetLocalized,
  formatSourceLabelLocalized,
  formatSubscriptionExpiryLocalized,
  languageModeFromValue,
  resolveLanguage,
  t,
  type LanguageMode,
  type ResolvedLanguage,
  type TextKey
} from "../utils/i18n";
import { reconcileChildren } from "./reconcileDom";
import { hasMeaningfulValue, isAlertMeter, isChatPassPath, meterProgress, chatGptPrimaryMeter, STALE_METER_MS } from "../platforms/presentation";
import { WIDGET_CSS } from "./styles";

type RefreshHandler = () => void;
type WidgetHandlers = {
  onLanguageModeSave?: (mode: LanguageMode) => void;
};
type ChipEdge = "left" | "right" | "top" | "bottom";

const PLATFORM_LABEL: Record<PlatformId, string> = {
  grok: "Grok",
  claude: "Claude",
  chatgpt: "GPT",
  kimi: "Kimi",
  gemini: "Gemini",
  perplexity: "Perplexity"
};

const GPT_SECTION_ORDER = [
  "subscription",
  "input",
  "features",
  "windows",
  "codex",
  "other"
] as const;

type GptSectionKey = (typeof GPT_SECTION_ORDER)[number];

type ChihiroAssetName =
  | "capsule-mascot.png"
  | "clover-medallion.png"
  | "corner-bottom-left.png"
  | "corner-bottom-right.png"
  | "corner-top-left.png"
  | "corner-top-right.png"
  | "divider-vine.png"
  | "gem-square.png"
  | "leaf-emblem.png"
  | "leaf-small.png"
  | "shield.png";

export class UsageWidget {
  private readonly host = document.createElement("div");
  private readonly shadow = this.host.attachShadow({ mode: "open" });
  private readonly root = document.createElement("div");
  private expanded = false;
  private hidden = false;
  private chipPosition = { edge: "right" as ChipEdge, offset: 96 };
  private loading = false;
  private settingsOpen = false;
  private renderFrame = 0;
  private destroyed = false;
  private readonly onResize = (): void => {
    if (!this.hidden && this.expanded) return;
    const chip = this.root.querySelector<HTMLElement>(".collapsed,.gpt-restore-chip");
    if (!chip) return;
    const bounds = chip.getBoundingClientRect();
    const vertical = this.chipPosition.edge === "left" || this.chipPosition.edge === "right";
    const maximum = (vertical ? window.innerHeight - bounds.height : window.innerWidth - bounds.width) - 8;
    this.chipPosition.offset = Math.max(8, Math.min(this.chipPosition.offset, maximum));
    this.applyChipPosition();
  };
  private snapshot: UsageSnapshot | null = null;
  private backoffUntil = 0;
  private languageMode: LanguageMode = DEFAULT_LANGUAGE_MODE;
  private resolvedLanguage: ResolvedLanguage = resolveLanguage(DEFAULT_LANGUAGE_MODE);
  private readonly timerId: number;
  private readonly mountWatchId: number;

  constructor(
    private readonly platform: PlatformId,
    private readonly onRefresh: RefreshHandler,
    private readonly handlers: WidgetHandlers = {}
  ) {
    this.expanded = false;
    this.hidden = platform === "chatgpt";
    this.host.id = "ai-usage-floating-monitor";
    this.host.dataset.platform = platform;
    const style = document.createElement("style");
    style.textContent = WIDGET_CSS;
    this.shadow.append(style, this.root);
    this.timerId = window.setInterval(() => this.tickTimes(), 1_000);
    this.mountWatchId = window.setInterval(() => this.ensureMounted(), 2_000);
    window.addEventListener("resize", this.onResize);
    this.root.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (this.settingsOpen) this.closeSettings();
      else { if (this.platform === "chatgpt") this.hidden = true; else this.expanded = false; this.render(); }
    });
  }

  mount(): void {
    this.ensureMounted();
    this.render();
  }

  destroy(): void {
    window.clearInterval(this.timerId);
    window.clearInterval(this.mountWatchId);
    this.destroyed = true;
    window.removeEventListener("resize", this.onResize);
    cancelAnimationFrame(this.renderFrame);
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

  setLanguageMode(value: LanguageMode): void {
    this.languageMode = value;
    this.resolvedLanguage = resolveLanguage(value);
    this.render();
  }

  private text(key: TextKey, params?: Record<string, string | number>): string {
    return t(this.resolvedLanguage, key, params);
  }

  private render(): void {
    if (this.destroyed || this.renderFrame) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = 0;
      if (!this.destroyed) this.renderNow();
    });
  }

  private tickTimes(): void {
    if (document.visibilityState === "hidden" || this.hidden || (this.platform !== "chatgpt" && !this.expanded)) return;
    for (const node of this.root.querySelectorAll<HTMLElement>("[data-time]")) {
      let value = node.textContent ?? "";
      if (node.dataset.time === "updated" && this.snapshot) value = this.text("meta.updatedAt", { age: formatAgeLocalized(this.resolvedLanguage, this.snapshot.updatedAt) });
      if (node.dataset.time === "checked" && this.snapshot?.checkedAt) value = this.text("meta.checkedAt", { age: formatAgeLocalized(this.resolvedLanguage, this.snapshot.checkedAt) });
      if (node.dataset.time === "backoff") value = this.text("meta.waitSeconds", { seconds: Math.max(0, Math.ceil(this.backoffRemainingMs() / 1000)) });
      const meter = this.snapshot?.meters.find((item) => item.key === node.dataset.meterKey);
      if (meter && node.dataset.time === "reset") value = this.formatMeterTimePreview(meter);
      if (meter && node.dataset.time === "badge") value = this.meterBadge(meter);
      if (meter && node.dataset.time === "subscription") value = formatMeterValueLocalized(this.resolvedLanguage, meter);
      if (node.textContent !== value) node.textContent = value;
    }
  }

  private renderNow(): void {
    this.ensureMounted();
    if (this.hidden) {
      this.settingsOpen = false;
      reconcileChildren(this.root, [this.platform === "chatgpt" ? this.renderChatGptRestoreChip() : emptyNode()]);
      return;
    }
    if (this.platform === "chatgpt") {
      if (!this.hidden) {
        this.resetPanelPosition();
      }
      this.replaceRootWith(this.renderChatGptPanel());
      return;
    }
    if (this.expanded) {
      this.resetPanelPosition();
    }
    this.replaceRootWith(this.expanded ? this.renderPanel() : this.renderCollapsed());
  }

  private ensureMounted(): void {
    if (!this.host.isConnected) {
      document.documentElement.append(this.host);
    }
  }

  private replaceRootWith(main: HTMLElement): void {
    if (this.settingsOpen) {
      reconcileChildren(this.root, [main, this.renderSettingsDialog()]);
      return;
    }
    reconcileChildren(this.root, [main]);
  }

  private schedulePlatformOverflowCheck(button: HTMLElement): void {
    const platformLabel = button.querySelector<HTMLElement>(".platform");
    if (!platformLabel) {
      return;
    }
    requestAnimationFrame(() => {
      if (!button.isConnected) {
        return;
      }
      button.classList.remove("platform-overflow");
      const platformName = platformLabel.textContent?.trim() ?? "";
      const overflows = platformLabel.scrollWidth > platformLabel.clientWidth + 1;
      const shouldSitBehindMascot = overflows || platformName.length >= 6;
      button.classList.toggle("platform-overflow", shouldSitBehindMascot);
    });
  }

  private renderChatGptRestoreChip(): HTMLElement {
    const button = el("button", "gpt-restore-chip");
    button.dataset.nodeKey = "chip";
    button.type = "button";
    this.applyChipPosition();
    button.setAttribute("aria-label", this.text("action.restoreGptPanel"));
    this.installChipDrag(button, () => {
      this.hidden = false;
      this.expanded = true;
      this.resetPanelPosition();
      this.render();
    });
    button.append(
      decorativeAsset("capsule-mascot.png", "capsule-mascot"),
      decorativeAsset("leaf-emblem.png", "chip-icon"),
      el("span", `status-dot status-${this.snapshot?.status ?? "unknown"}`),
      node("span", "collapsed-main", [
        textEl("span", "platform", "GPT"),
        textEl("span", "primary", this.chatGptPrimaryValue())
      ])
    );
    this.schedulePlatformOverflowCheck(button);
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
    this.host.style.top = "";
    this.host.style.right = "";
    this.host.style.bottom = "";
    this.host.style.left = "";
    this.host.style.transform = "";
  }

  private installChipDrag(button: HTMLButtonElement, onActivate: () => void): void {
    let startX = 0;
    let startY = 0;
    let moved = false;
    let suppressPointerClickUntil = 0;

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
      if (moved) {
        suppressPointerClickUntil = Date.now() + 350;
        event.preventDefault();
      }
    };

    button.addEventListener("click", (event) => {
      if (event.detail > 0 && Date.now() < suppressPointerClickUntil) {
        suppressPointerClickUntil = 0;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      suppressPointerClickUntil = 0;
      onActivate();
    });

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

  private renderChatGptPanel(): HTMLElement {
    const panel = el("section", "gpt-panel");
    panel.dataset.nodeKey = "panel";
    panel.append(
      panelCorners("panel-corners"),
      this.renderChatGptHeader(),
      this.renderMeta(),
      vineDivider(),
      this.renderChatGptContent()
    );
    return panel;
  }

  private renderChatGptHeader(): HTMLElement {
    const header = el("div", "header gpt-header");
    const title = titleNode("title gpt-title", this.text("gpt.title"), "clover-medallion.png");
    const right = el("div", "gpt-header-right");
    right.append(
      textEl("span", "gpt-alerts", this.text("gpt.alertCount", { count: this.alertCount() }))
    );

    const actions = el("div", "actions gpt-actions");
    const refresh = this.renderActionButton(
      this.loading ? "..." : "↻",
      this.text("action.refreshUsage"),
      () => this.onRefresh()
    );
    refresh.disabled = this.loading || this.backoffRemainingMs() > 0;
    refresh.setAttribute("aria-busy", String(this.loading));

    const close = this.renderActionButton("×", this.text("action.hidePanel"), () => {
      this.hidden = true;
      this.render();
    });

    actions.append(this.renderSettingsButton(), refresh, close);
    right.append(actions);
    header.append(title, right);
    return header;
  }

  private renderChatGptContent(): HTMLElement {
    const content = el("div", "content gpt-content");
    if (this.snapshot?.errorMessage) {
      content.append(textEl("div", "error", this.snapshot.meters.length ? (this.resolvedLanguage === "zh-CN" ? "部分查询失败，显示上次读数" : "Some queries failed. Showing saved readings.") : (this.resolvedLanguage === "zh-CN" ? "暂时无法获取额度，请稍后刷新" : "Usage unavailable. Try refreshing later.")));
    }
    const meters = this.chatGptMeters();
    if (meters.length === 0) {
      content.append(textEl("div", "empty", this.loading ? this.text("meta.loading") : this.text("usage.empty")));
      return content;
    }
    for (const section of groupChatGptMeters(meters, this.resolvedLanguage)) {
      content.append(this.renderMeterSection(section.label, section.meters, section.key));
    }
    return content;
  }

  private closeSettings(): void {
    this.settingsOpen = false;
    this.render();
    requestAnimationFrame(() => this.root.querySelector<HTMLButtonElement>('[data-action="settings"]')?.focus());
  }

  private renderSettingsDialog(): HTMLElement {
    const panel = el("section", "settings-popover");
    panel.dataset.nodeKey = "settings";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", this.text("settings.title"));
    const header = el("div", "settings-header");
    header.append(titleNode("settings-title", this.text("settings.title"), "clover-medallion.png"),
      this.renderActionButton("×", this.text("action.closeSettings"), () => this.closeSettings()));
    const select = document.createElement("select");
    select.className = "settings-input";
    select.dataset.nodeKey = "language";
    select.setAttribute("aria-label", this.text("language.label"));
    for (const [value, label] of [["auto", "language.auto"], ["zh-CN", "language.zhCN"], ["en", "language.en"]] as const) {
      const option = document.createElement("option"); option.value = value; option.textContent = this.text(label); select.append(option);
    }
    select.value = this.languageMode;
    select.addEventListener("change", () => { const mode = languageModeFromValue(select.value); this.setLanguageMode(mode); this.handlers.onLanguageModeSave?.(mode); });
    panel.append(header, textEl("label", "settings-label", this.text("language.label")), select);
    return panel;
  }

  private renderMeterSection(label: string, meters: UsageMeter[], groupKey: string): HTMLElement {
    const section = el("section", "meter-section");
    section.dataset.nodeKey = `section:${groupKey}`;
    section.append(cardCorners(), sectionTitle(label, "leaf-small.png"));
    for (const meter of meters) {
      section.append(this.renderMeter(meter));
    }
    return section;
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

  private renderSettingsButton(): HTMLButtonElement {
    const button = this.renderActionButton("⚙", this.text("action.settings"), () => { this.settingsOpen = !this.settingsOpen; this.render(); });
    button.dataset.action = "settings";
    return button;
  }

  private renderCollapsed(): HTMLElement {
    const button = el("button", "collapsed");
    button.dataset.nodeKey = "chip";
    button.type = "button";
    button.setAttribute(
      "aria-label",
      this.text("action.openUsage", { platform: PLATFORM_LABEL[this.platform] })
    );
    this.applyChipPosition();
    this.installChipDrag(button, () => {
      this.expanded = true;
      this.render();
    });

    button.append(
      decorativeAsset("capsule-mascot.png", "capsule-mascot"),
      decorativeAsset(platformTitleAsset(this.platform), "chip-icon"),
      el("span", `status-dot status-${this.snapshot?.status ?? "unknown"}`),
      node("span", "collapsed-main", [
        textEl("span", "platform", PLATFORM_LABEL[this.platform]),
        textEl("span", "primary", this.collapsedPrimaryValue())
      ])
    );
    this.schedulePlatformOverflowCheck(button);
    return button;
  }

  private renderPanel(): HTMLElement {
    const panel = el("section", "panel");
    panel.dataset.nodeKey = "panel";
    panel.append(panelCorners("panel-corners compact-corners"), this.renderHeader(), this.renderMeta(), vineDivider());
    if (this.platform === "grok") {
      const modelMeta = this.renderGrokModelMeta();
      if (modelMeta) {
        panel.append(modelMeta);
      }
    }
    panel.append(this.renderContent());
    return panel;
  }

  private renderHeader(): HTMLElement {
    const header = el("div", "header");
    const title = titleNode(
      "title",
      this.text("usage.title", { platform: PLATFORM_LABEL[this.platform] }),
      platformTitleAsset(this.platform)
    );
    const actions = el("div", "actions");

    const refresh = textEl("button", "icon-button", this.loading ? "..." : "↻");
    refresh.type = "button";
    refresh.setAttribute("aria-label", this.text("action.refreshUsage"));
    refresh.title = this.text("action.refreshUsage");
    refresh.disabled = this.loading || this.backoffRemainingMs() > 0;
    refresh.addEventListener("click", this.onRefresh);

    const close = textEl("button", "icon-button", "×");
    close.type = "button";
    close.setAttribute("aria-label", this.text("action.collapseWidget"));
    close.title = this.text("action.collapseWidget");
    close.addEventListener("click", () => {
      this.expanded = false;
      this.render();
    });

    actions.append(this.renderSettingsButton(), refresh, close);
    header.append(title, actions);
    return header;
  }

  private renderMeta(): HTMLElement {
    const meta = el("div", "meta");
    const updated = this.snapshot
      ? this.text("meta.updatedAt", {
          age: formatAgeLocalized(this.resolvedLanguage, this.snapshot.updatedAt)
        })
      : this.text("meta.neverUpdated");
    const right =
      this.backoffRemainingMs() > 0
        ? this.text("meta.waitSeconds", {
            seconds: Math.ceil(this.backoffRemainingMs() / 1000)
          })
        : this.platform === "chatgpt" && this.snapshot?.checkedAt
          ? this.text("meta.checkedAt", {
              age: formatAgeLocalized(this.resolvedLanguage, this.snapshot.checkedAt)
            })
        : this.snapshot?.cacheAgeMs !== undefined
          ? this.text("meta.cacheSeconds", {
              seconds: Math.floor(this.snapshot.cacheAgeMs / 1000)
            })
          : this.loading
            ? this.text("meta.loading")
            : "";
    const updatedNode = textEl("span", "", updated); updatedNode.dataset.time = "updated";
    const rightNode = textEl("span", "", right); rightNode.dataset.time = this.backoffRemainingMs() > 0 ? "backoff" : this.snapshot?.checkedAt ? "checked" : "cache";
    const leftWrap = el("span", "meta-item"); leftWrap.append(decorativeAsset("leaf-small.png", "inline-icon"), updatedNode);
    const rightWrap = el("span", "meta-item"); rightWrap.append(rightNode);
    meta.append(leftWrap, rightWrap);
    return meta;
  }

  private renderGrokModelMeta(): HTMLElement | null {
    const summary = this.grokModelSummary();
    if (!summary) {
      return null;
    }
    const meta = el("div", "model-meta");
    const value = textEl("span", "model-value", summary);
    value.title = summary;
    meta.append(textEl("span", "model-label", this.text("model.label")), value);
    return meta;
  }

  private renderContent(): HTMLElement {
    const content = el("div", "content");
    if (this.snapshot?.errorMessage) {
      content.append(textEl("div", "error", this.snapshot.errorMessage));
    }
    const meters = (this.snapshot?.meters ?? []).filter(hasMeaningfulValue);
    if (meters.length === 0) {
      content.append(textEl("div", "empty", this.loading ? this.text("meta.loading") : this.text("usage.empty")));
      return content;
    }
    if (this.platform === "grok" && this.appendGrokCreditsContent(content, meters)) {
      return content;
    }
    for (const meter of meters) {
      content.append(this.renderMeter(meter));
    }
    return content;
  }

  private appendGrokCreditsContent(content: HTMLElement, meters: UsageMeter[]): boolean {
    const total = meters.find((meter) => meter.rawKind === "grokCreditsConfig:total");
    const products = meters
      .filter(isGrokCreditsProductMeter)
      .sort(grokCreditsProductCompare);
    if (!total && products.length === 0) {
      return false;
    }
    if (total) {
      content.append(this.renderGrokCreditsMeter(total, products));
    } else {
      for (const product of products) {
        content.append(this.renderMeter(product));
      }
    }
    for (const meter of meters) {
      if (meter !== total && !isGrokCreditsProductMeter(meter)) {
        content.append(this.renderMeter(meter));
      }
    }
    return true;
  }

  private renderGrokCreditsMeter(total: UsageMeter, products: UsageMeter[]): HTMLElement {
    const row = el("div", "meter grok-credits-meter");
    row.dataset.nodeKey = `meter:${total.key}`;
    const top = el("div", "meter-top");
    top.append(
      textEl(
        "div",
        "meter-label",
        formatMeterLabelLocalized(this.resolvedLanguage, total)
      ),
      textEl("div", "meter-value", this.formatUsedPercentValue(total))
    );

    const progress = usedMeterProgress(total);
    const bar = el("div", "bar grok-stack-bar");
    const stack = el("div", "grok-stack-fill");
    const visibleProducts = products.filter((product) => usedMeterProgress(product) > 0);
    if (visibleProducts.length > 0) {
      visibleProducts.forEach((product, index) => {
        const segment = el("span", "grok-stack-segment");
        const value = usedMeterProgress(product);
        segment.style.width = `${value}%`;
        segment.style.background = grokContributionColor(index);
        segment.title = `${formatMeterLabelLocalized(
          this.resolvedLanguage,
          product
        )} ${this.formatUsedPercentValue(product)}`;
        stack.append(segment);
      });
    } else {
      const segment = el("span", "grok-stack-segment");
      segment.style.width = `${progress}%`;
      segment.style.background = grokContributionColor(0);
      stack.append(segment);
    }
    bar.style.setProperty("--meter-progress", `${progress}%`);
    bar.append(stack, decorativeAsset("leaf-small.png", "progress-leaf"));

    const details = el("div", "grok-contribution-list");
    products.forEach((product, index) => {
      const item = el("span", "grok-contribution");
      const dot = el("span", "grok-contribution-dot");
      dot.style.background = grokContributionColor(index);
      item.append(
        dot,
        textEl(
          "span",
          "grok-contribution-label",
          formatMeterLabelLocalized(this.resolvedLanguage, product)
        ),
        textEl("span", "grok-contribution-value", this.formatUsedPercentValue(product))
      );
      details.append(item);
    });

    row.append(top, bar);
    if (products.length > 0) {
      row.append(details);
    }
    row.append(this.renderMeterBottom(total));
    return row;
  }

  private renderMeter(meter: UsageMeter): HTMLElement {
    const row = el("div", "meter");
    row.dataset.nodeKey = `meter:${meter.key}`;
    const top = el("div", "meter-top");
    top.append(
      textEl(
        "div",
        "meter-label",
        formatMeterLabelLocalized(this.resolvedLanguage, meter)
      ),
      textEl(
        "div",
        "meter-value",
        formatMeterValueLocalized(this.resolvedLanguage, meter)
      )
    );

    const progress = meterProgress(meter);
    const bar = el("div", "bar");
    const fill = el("div", "bar-fill");
    if (typeof meter.remainingPercent === "number") {
      fill.classList.add("remaining-fill");
    }
    fill.style.width = `${progress}%`;
    bar.style.setProperty("--meter-progress", `${progress}%`);
    bar.append(fill, decorativeAsset("leaf-small.png", "progress-leaf"));

    if (meter.rawKind === "chatgpt.subscription") { const value = top.querySelector<HTMLElement>(".meter-value"); if (value) { value.dataset.time = "subscription"; value.dataset.meterKey = meter.key; } }
    const label = top.querySelector<HTMLElement>(".meter-label"); if (label) label.title = label.textContent ?? "";
    row.append(top);
    if (progress !== null) row.append(bar);
    row.append(this.renderMeterBottom(meter));
    return row;
  }

  private meterBadge(meter: UsageMeter): string {
    const source = formatSourceLabelLocalized(this.resolvedLanguage, meter.source);
    const uncalibrated = meter.quotaState === "unknown" ? (this.resolvedLanguage === "zh-CN" ? "未校准" : "Uncalibrated") : formatConfidenceLabelLocalized(this.resolvedLanguage, meter.confidence);
    const age = meter.observedAt ? formatAgeLocalized(this.resolvedLanguage, meter.observedAt) : "";
    const stale = this.platform === "chatgpt" && meter.observedAt && Date.now() - meter.observedAt > STALE_METER_MS
      ? (this.resolvedLanguage === "zh-CN" ? " · 数据较旧" : " · Stale") : "";
    return `${source} · ${uncalibrated}${age ? ` · ${age}` : ""}${stale}`;
  }

  private renderMeterBottom(meter: UsageMeter): HTMLElement {
    const bottom = el("div", "meter-bottom");
    const badge = textEl("span", "badge", this.meterBadge(meter));
    badge.dataset.time = "badge"; badge.dataset.meterKey = meter.key;
    const reset = textEl("span", "", this.formatMeterTimePreview(meter));
    reset.dataset.time = "reset"; reset.dataset.meterKey = meter.key;
    bottom.append(badge, reset);
    return bottom;
  }

  private formatMeterTimePreview(meter: UsageMeter): string {
    if (meter.unit === "bytes" && typeof meter.used === "number" && typeof meter.total === "number") {
      const fmt = (n: number): string => (n / 1073741824).toLocaleString(this.resolvedLanguage, { maximumFractionDigits: 2 });
      return this.resolvedLanguage === "zh-CN" ? `已用 ${fmt(meter.used)} / 共 ${fmt(meter.total)} GiB` : `Used ${fmt(meter.used)} / ${fmt(meter.total)} GiB`;
    }
    if (meter.quotaState === "unknown") return "";
    if (meter.rawKind === "chatgpt.subscription") {
      return formatSubscriptionExpiryLocalized(this.resolvedLanguage, meter);
    }
    return formatResetLocalized(this.resolvedLanguage, meter);
  }

  private formatUsedPercentValue(meter: UsageMeter): string {
    if (typeof meter.usedPercent === "number") {
      return this.text("meter.usedPercent", {
        percent: Math.round(meter.usedPercent)
      });
    }
    return formatMeterValueLocalized(this.resolvedLanguage, meter);
  }

  private primaryValue(): string {
    const meters = this.snapshot?.meters ?? [];
    const byRemaining = meters
      .filter((meter) => typeof meter.remaining === "number")
      .sort((a, b) => (a.remaining ?? 0) - (b.remaining ?? 0))[0];
    if (byRemaining?.remaining !== undefined && byRemaining.remaining !== null) {
      return `${byRemaining.remaining}`;
    }
    const byRemainingPercent = meters
      .filter((meter) => typeof meter.remainingPercent === "number")
      .sort((a, b) => (a.remainingPercent ?? 0) - (b.remainingPercent ?? 0))[0];
    if (
      byRemainingPercent?.remainingPercent !== undefined &&
      byRemainingPercent.remainingPercent !== null
    ) {
      return this.text("meter.remainingPercent", {
        percent: Math.round(byRemainingPercent.remainingPercent)
      });
    }
    const byPercent = meters.find((meter) => typeof meter.usedPercent === "number");
    if (byPercent?.usedPercent !== undefined && byPercent.usedPercent !== null) {
      return `${Math.round(byPercent.usedPercent)}%`;
    }
    return "?";
  }

  private collapsedPrimaryValue(): string {
    if (this.platform === "grok") {
      return this.grokPrimaryValue();
    }
    return this.primaryValue();
  }

  private alertCount(): number {
    return this.chatGptMeters().filter(isAlertMeter).length;
  }

  private chatGptMeters(): UsageMeter[] {
    const meters = [...(this.snapshot?.meters ?? [])].filter((meter) =>
      hasMeaningfulValue(meter) && !isChatPassPath(meter.key));
    return meters.sort((a, b) => chatGptMeterPriority(a) - chatGptMeterPriority(b));
  }

  private chatGptPrimaryValue(): string {
    const meters = this.chatGptMeters();
    const primary = chatGptPrimaryMeter(meters);
    return primary ? formatMeterValueLocalized(this.resolvedLanguage, primary) : "?";
  }

  private backoffRemainingMs(): number {
    return Math.max(0, this.backoffUntil - Date.now());
  }

  private grokModelSummary(): string {
    const values = unique(
      (this.snapshot?.meters ?? [])
        .map((meter) => modelSummaryFromMeter(meter))
        .filter((value): value is string => Boolean(value))
    );
    return values.join(", ");
  }

  private grokPrimaryValue(): string {
    const meter = this.grokPrimaryMeter();
    if (!meter) {
      return this.primaryValue();
    }
    if (meter.rawKind?.startsWith("grokCreditsConfig:")) {
      return this.formatUsedPercentValue(meter);
    }
    return formatMeterValueLocalized(this.resolvedLanguage, meter);
  }

  private grokPrimaryMeter(): UsageMeter | null {
    const meters = [...(this.snapshot?.meters ?? [])];
    return (
      meters.sort(
        (a, b) =>
          grokMeterPriority(a) - grokMeterPriority(b) ||
          (b.observedAt ?? 0) - (a.observedAt ?? 0)
      )[0] ?? null
    );
  }
}

function usedMeterProgress(meter: UsageMeter): number {
  if (typeof meter.usedPercent === "number") {
    return clampPercent(meter.usedPercent);
  }
  return meterProgress(meter) ?? 0;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function chatGptMeterPriority(meter: UsageMeter): number {
  const key = meter.key.toLowerCase();
  const label = meter.label.toLowerCase();
  if (key.startsWith("limits_progress:file_upload")) {
    return 10;
  }
  if (
    key.startsWith("limits_progress:") ||
    key.startsWith("blocked_features:") ||
    meter.rawKind === "limits_progress" ||
    meter.rawKind === "blocked_features"
  ) {
    return 20;
  }
  if (label.includes("primary window") || label.includes("5-hour window")) {
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

function groupChatGptMeters(
  meters: UsageMeter[],
  language: ResolvedLanguage
): Array<{ key: GptSectionKey; label: string; meters: UsageMeter[] }> {
  const groups: Record<GptSectionKey, UsageMeter[]> = {
    subscription: [],
    input: [],
    features: [],
    windows: [],
    codex: [],
    other: []
  };
  for (const meter of meters) {
    groups[chatGptMeterSection(meter)].push(meter);
  }
  return GPT_SECTION_ORDER.map((key) => ({
    key,
    label: formatGptSectionLabelLocalized(language, key),
    meters: groups[key]
  })).filter((section) => section.meters.length > 0);
}

function chatGptMeterSection(meter: UsageMeter): GptSectionKey {
  const key = meter.key.toLowerCase();
  const rawKind = meter.rawKind?.toLowerCase() ?? "";
  const label = meter.label.toLowerCase();

  if (rawKind === "chatgpt.library_storage") return "input";
  if (rawKind === "chatgpt.reset_credits") return "codex";
  if (rawKind === "chatgpt.subscription") {
    return "subscription";
  }
  if (
    key.includes("codex") ||
    rawKind === "codex.settings.usage" ||
    rawKind.includes("codex") ||
    rawKind === "credits" ||
    key === "wham:credits"
  ) {
    return "codex";
  }
  if (
    key.startsWith("wham:") ||
    key.startsWith("tasks:") ||
    rawKind.includes("rate_limit") ||
    rawKind.includes("window")
  ) {
    return "windows";
  }
  if (
    rawKind === "limits_progress" ||
    rawKind === "blocked_features" ||
    key.startsWith("limits_progress:") ||
    key.startsWith("blocked_features:")
  ) {
    return isInputOrAttachmentMeter(key, label) ? "input" : "features";
  }
  return "other";
}

function isInputOrAttachmentMeter(key: string, label: string): boolean {
  return (
    key.includes("file_upload") ||
    key.includes("paste_text") ||
    key.includes("dictation") ||
    key.includes("upload") ||
    label.includes("file upload") ||
    label.includes("paste text") ||
    label.includes("dictation")
  );
}

function grokMeterPriority(meter: UsageMeter): number {
  if (meter.rawKind === "grokCreditsConfig:total") {
    return 10;
  }
  if (meter.rawKind?.startsWith("grokCreditsConfig:product:")) {
    return 20;
  }
  if (meter.rawKind === "queries") {
    return 40;
  }
  if (meter.rawKind === "highEffortRateLimits") {
    return 50;
  }
  if (meter.rawKind === "lowEffortRateLimits") {
    return 60;
  }
  if (meter.rawKind === "tokens") {
    return 70;
  }
  return 80;
}

function isGrokCreditsProductMeter(meter: UsageMeter): boolean {
  return Boolean(meter.rawKind?.startsWith("grokCreditsConfig:product:"));
}

function grokCreditsProductCompare(a: UsageMeter, b: UsageMeter): number {
  return grokCreditsProductPriority(a) - grokCreditsProductPriority(b);
}

function grokCreditsProductPriority(meter: UsageMeter): number {
  const productId = Number(meter.rawKind?.match(/product:(\d+)/)?.[1] ?? 0);
  const priority: Record<number, number> = {
    5: 10,
    4: 20,
    1: 30,
    2: 40
  };
  return priority[productId] ?? 90;
}

function grokContributionColor(index: number): string {
  return [
    "var(--rb-blue)",
    "var(--rb-blue-soft)",
    "#9fb9e8",
    "#c4d2ef",
    "var(--rb-mustard)"
  ][index % 5];
}

function modelSummaryFromMeter(meter: UsageMeter): string | null {
  if (!meter.modelName) {
    return null;
  }
  if (meter.requestKind && meter.requestKind !== "DEFAULT") {
    return `${meter.modelName} · ${meter.requestKind}`;
  }
  return meter.modelName;
}

function assetUrl(name: ChihiroAssetName): string {
  const path = `assets/little-chihiro/${name}`;
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(path);
  }
  return path;
}

function decorativeAsset(name: ChihiroAssetName, className: string): HTMLImageElement {
  const image = document.createElement("img");
  image.className = className;
  image.src = assetUrl(name);
  image.alt = "";
  image.decoding = "async";
  image.draggable = false;
  image.setAttribute("aria-hidden", "true");
  return image;
}

function titleNode(
  className: string,
  label: string,
  assetName: ChihiroAssetName
): HTMLElement {
  const title = el("div", className);
  title.append(
    decorativeAsset(assetName, "title-icon"),
    textEl("span", "title-text", label)
  );
  return title;
}

function sectionTitle(label: string, assetName: ChihiroAssetName): HTMLElement {
  const title = el("div", "meter-section-title");
  title.append(
    decorativeAsset(assetName, "section-title-icon"),
    textEl("span", "section-title-text", label)
  );
  return title;
}

function iconText<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  assetName: ChihiroAssetName,
  label: string
): HTMLElementTagNameMap[K] {
  const element = el(tagName, className);
  element.append(decorativeAsset(assetName, "inline-icon"), document.createTextNode(label));
  return element;
}

function panelCorners(className: string): HTMLElement {
  const frame = el("div", className);
  frame.append(
    decorativeAsset("corner-top-left.png", "corner corner-top-left"),
    decorativeAsset("corner-top-right.png", "corner corner-top-right"),
    decorativeAsset("corner-bottom-left.png", "corner corner-bottom-left"),
    decorativeAsset("corner-bottom-right.png", "corner corner-bottom-right")
  );
  frame.setAttribute("aria-hidden", "true");
  return frame;
}

function cardCorners(): HTMLElement {
  const frame = el("div", "card-corners");
  frame.append(
    decorativeAsset("corner-top-left.png", "card-corner card-corner-top-left"),
    decorativeAsset("corner-bottom-right.png", "card-corner card-corner-bottom-right")
  );
  frame.setAttribute("aria-hidden", "true");
  return frame;
}

function vineDivider(): HTMLElement {
  const divider = el("div", "vine-divider");
  divider.append(decorativeAsset("divider-vine.png", "vine-divider-image"));
  divider.setAttribute("aria-hidden", "true");
  return divider;
}

function platformTitleAsset(platform: PlatformId): ChihiroAssetName {
  if (platform === "chatgpt") {
    return "clover-medallion.png";
  }
  if (platform === "claude") {
    return "leaf-emblem.png";
  }
  if (platform === "kimi") {
    return "leaf-emblem.png";
  }
  if (platform === "gemini") {
    return "gem-square.png";
  }
  if (platform === "perplexity") {
    return "gem-square.png";
  }
  return "leaf-small.png";
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
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
