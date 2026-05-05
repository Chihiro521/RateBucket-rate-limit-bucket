import type { PlatformId, UsageMeter, UsageSnapshot } from "../platforms/types";
import type { ChatGPTSentinelState } from "../platforms/chatgptSentinel";
import type {
  IpRiskPublicSettings,
  IpRiskSettingsUpdate,
  IpRiskState
} from "../platforms/ipRisk";
import {
  DEFAULT_LANGUAGE_MODE,
  formatAgeLocalized,
  formatConfidenceLabelLocalized,
  formatGptSectionLabelLocalized,
  formatMeterLabelLocalized,
  formatMeterValueLocalized,
  formatResetLocalized,
  formatRiskLabelLocalized,
  formatSourceLabelLocalized,
  formatStatusLabelLocalized,
  languageModeFromValue,
  resolveLanguage,
  t,
  type LanguageMode,
  type ResolvedLanguage,
  type TextKey
} from "../utils/i18n";
import { WIDGET_CSS } from "./styles";

type RefreshHandler = () => void;
type WidgetHandlers = {
  onIpRiskRefresh?: () => void;
  onIpRiskSettingsSave?: (update: IpRiskSettingsUpdate) => void;
  onLanguageModeSave?: (mode: LanguageMode) => void;
};
type IpRiskSettingsDraft = {
  enabled: boolean;
  apiKeyValue: string;
  keyDirty: boolean;
  revealKey: boolean;
};
type ChipEdge = "left" | "right" | "top" | "bottom";

const PLATFORM_LABEL: Record<PlatformId, string> = {
  grok: "Grok",
  claude: "Claude",
  chatgpt: "GPT",
  kimi: "Kimi"
};

const GPT_SECTION_ORDER = [
  "input",
  "features",
  "windows",
  "codex",
  "other"
] as const;

type GptSectionKey = (typeof GPT_SECTION_ORDER)[number];

type NahidaAssetName =
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
  private snapshot: UsageSnapshot | null = null;
  private chatGptSentinelState: ChatGPTSentinelState | null = null;
  private ipRiskState: IpRiskState | null = null;
  private ipRiskSettings: IpRiskPublicSettings = {
    provider: "proxycheck",
    enabled: false,
    hasApiKey: false,
    apiKeyPreview: null
  };
  private ipRiskRefreshing = false;
  private ipRiskSettingsOpen = false;
  private ipRiskSettingsDraft: IpRiskSettingsDraft | null = null;
  private backoffUntil = 0;
  private languageMode: LanguageMode = DEFAULT_LANGUAGE_MODE;
  private resolvedLanguage: ResolvedLanguage = resolveLanguage(DEFAULT_LANGUAGE_MODE);
  private readonly timerId: number;

  constructor(
    private readonly platform: PlatformId,
    private readonly onRefresh: RefreshHandler,
    private readonly handlers: WidgetHandlers = {}
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

  setChatGptSentinelState(value: ChatGPTSentinelState | null): void {
    this.chatGptSentinelState = value;
    this.render();
  }

  setIpRiskSettings(value: IpRiskPublicSettings): void {
    this.ipRiskSettings = value;
    this.render();
  }

  setIpRiskState(value: IpRiskState | null): void {
    this.ipRiskState = value;
    this.render();
  }

  setIpRiskRefreshing(value: boolean): void {
    this.ipRiskRefreshing = value;
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

  private createIpRiskSettingsDraft(): IpRiskSettingsDraft {
    return {
      enabled: this.ipRiskSettings.enabled,
      apiKeyValue: this.ipRiskSettings.apiKeyPreview ?? "",
      keyDirty: false,
      revealKey: false
    };
  }

  private closeIpRiskSettingsDialog(): void {
    this.ipRiskSettingsOpen = false;
    this.ipRiskSettingsDraft = null;
    this.render();
  }

  private render(): void {
    if (this.hidden) {
      this.ipRiskSettingsOpen = false;
      this.ipRiskSettingsDraft = null;
      this.root.replaceChildren(
        this.platform === "chatgpt" ? this.renderChatGptRestoreChip() : emptyNode()
      );
      return;
    }
    if (this.platform === "chatgpt") {
      if (!this.hidden) {
        this.resetPanelPosition();
      }
      this.replaceRootWith(
        this.expanded ? this.renderChatGptPanel() : this.renderChatGptCollapsed()
      );
      return;
    }
    if (this.expanded) {
      this.resetPanelPosition();
    }
    this.replaceRootWith(this.expanded ? this.renderPanel() : this.renderCollapsed());
  }

  private replaceRootWith(main: HTMLElement): void {
    if (this.ipRiskSettingsOpen) {
      this.root.replaceChildren(main, this.renderIpRiskSettingsDialog());
      return;
    }
    this.root.replaceChildren(main);
  }

  private renderChatGptRestoreChip(): HTMLElement {
    const button = el("button", "gpt-restore-chip");
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

  private renderChatGptCollapsed(): HTMLElement {
    const panel = el("section", "gpt-collapsed-panel");
    const title = titleNode("gpt-title", this.text("gpt.title"), "clover-medallion.png");
    const summary = textEl("div", "gpt-collapsed-summary", this.criticalSummary());
    const actions = el("div", "gpt-actions");

    const refresh = this.renderActionButton(
      this.loading ? "..." : "↻",
      this.text("action.refreshUsage"),
      () => this.onRefresh()
    );
    refresh.disabled = this.loading || this.backoffRemainingMs() > 0;

    const expand = this.renderActionButton("+", this.text("action.expandPanel"), () => {
      this.expanded = true;
      this.render();
    });
    const close = this.renderActionButton("×", this.text("action.hidePanel"), () => {
      this.hidden = true;
      this.render();
    });

    actions.append(this.renderSettingsButton(), refresh, expand, close);
    panel.append(decorativeAsset("capsule-mascot.png", "capsule-mascot"), title, summary, actions);
    return panel;
  }

  private renderChatGptPanel(): HTMLElement {
    const panel = el("section", "gpt-panel");
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

    const collapse = this.renderActionButton("−", this.text("action.collapsePanel"), () => {
      this.expanded = false;
      this.render();
    });
    const close = this.renderActionButton("×", this.text("action.hidePanel"), () => {
      this.hidden = true;
      this.render();
    });

    actions.append(this.renderSettingsButton(), refresh, collapse, close);
    right.append(actions);
    header.append(title, right);
    return header;
  }

  private renderChatGptContent(): HTMLElement {
    const content = el("div", "content gpt-content");
    if (this.snapshot?.errorMessage) {
      content.append(textEl("div", "error", this.snapshot.errorMessage));
    }
    const sentinelSection = this.renderChatGptSentinelSection();
    if (sentinelSection) {
      content.append(sentinelSection);
    }
    content.append(this.renderIpRiskSection());
    const meters = this.chatGptMeters();
    if (meters.length === 0) {
      if (!sentinelSection && !this.ipRiskSettings.enabled) {
        content.append(textEl("div", "empty", this.text("usage.empty")));
      }
      return content;
    }
    for (const section of groupChatGptMeters(meters, this.resolvedLanguage)) {
      content.append(this.renderMeterSection(section.label, section.meters));
    }
    return content;
  }

  private renderChatGptSentinelSection(): HTMLElement | null {
    const state = this.chatGptSentinelState;
    if (!state) {
      return null;
    }
    const section = el("section", "meter-section sentinel-section");
    section.append(cardCorners(), decorativeAsset("gem-square.png", "section-badge"));
    section.append(sectionTitle(this.text("sentinel.accountStatus"), "leaf-small.png"));

    const gate = el("div", "sentinel-block");
    gate.append(
      this.renderSentinelRow(
        this.text("sentinel.gate"),
        `${formatRiskLabelLocalized(
          this.resolvedLanguage,
          state.sentinelRisk.label
        )} ${state.sentinelRisk.score}/100`
      ),
      this.renderSentinelBar(state.sentinelRisk.score),
      this.renderSentinelRow(
        "PoW",
        `${state.pow.raw ?? "-"} / ${state.pow.level} / ${state.pow.risk}`
      ),
      textEl("div", "sentinel-explanation", this.text("sentinel.explanation"))
    );
    section.append(gate);
    return section;
  }

  private renderIpRiskSection(): HTMLElement {
    const section = el("section", "meter-section ip-risk-section");
    section.append(cardCorners(), decorativeAsset("shield.png", "section-badge shield-badge"));
    section.append(sectionTitle(this.text("usage.networkRisk"), "leaf-small.png"));

    const block = el("div", "sentinel-block ip-risk-block");
    block.append(this.renderSentinelRow(this.text("ip.check"), this.ipRiskStatusText()));

    const freshIpRisk = this.freshIpRiskState();
    if (freshIpRisk) {
      block.append(
        this.renderSentinelBar(freshIpRisk.score),
        this.renderSentinelRow(
          this.text("ip.signal"),
          formatIpRiskSignals(freshIpRisk, this.resolvedLanguage)
        ),
        this.renderSentinelRow(this.text("ip.source"), freshIpRisk.source)
      );
    } else if (this.ipRiskRefreshing) {
      block.append(textEl("div", "sentinel-explanation", this.text("ip.querying")));
    } else if (
      this.ipRiskSettings.enabled &&
      this.ipRiskSettings.hasApiKey &&
      this.ipRiskState?.status === "error"
    ) {
      block.append(
        textEl(
          "div",
          "sentinel-explanation error-text",
          this.ipRiskState.errorMessage ?? this.text("ip.errorFallback")
        )
      );
    } else {
      block.append(
        textEl(
          "div",
          "sentinel-explanation",
          this.ipRiskSettings.enabled
            ? this.text("ip.enabledHelp")
            : this.text("ip.disabledHelp")
        )
      );
    }

    section.append(block);
    return section;
  }

  private renderIpRiskSettingsDialog(): HTMLElement {
    const panel = el("section", "settings-popover");
    const header = el("div", "settings-header");
    const draft = this.ipRiskSettingsDraft ?? this.createIpRiskSettingsDraft();
    this.ipRiskSettingsDraft = draft;
    header.append(
      titleNode("settings-title", this.text("settings.title"), "shield.png"),
      this.renderActionButton("×", this.text("action.closeSettings"), () => {
        this.closeIpRiskSettingsDialog();
      })
    );

    const languageSelect = document.createElement("select");
    languageSelect.className = "settings-input";
    for (const [value, label] of [
      ["auto", this.text("language.auto")],
      ["zh-CN", this.text("language.zhCN")],
      ["en", this.text("language.en")]
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      languageSelect.append(option);
    }
    languageSelect.value = this.languageMode;

    const enabledInput = document.createElement("input");
    enabledInput.type = "checkbox";
    enabledInput.checked = draft.enabled;
    enabledInput.addEventListener("change", () => {
      draft.enabled = enabledInput.checked;
    });

    const enabledLabel = el("label", "settings-check");
    enabledLabel.append(
      enabledInput,
      textEl("span", "", this.text("ip.enableProxycheck"))
    );

    const keyInputWrap = el("div", "settings-input-wrap");
    const keyInput = document.createElement("input");
    keyInput.className = "settings-input";
    keyInput.type = draft.revealKey ? "text" : "password";
    keyInput.autocomplete = "off";
    keyInput.spellcheck = false;
    keyInput.value = draft.apiKeyValue;
    keyInput.placeholder =
      draft.keyDirty && this.ipRiskSettings.hasApiKey
        ? this.text("ip.newKeyPlaceholder")
        : this.ipRiskSettings.hasApiKey
          ? this.text("ip.savedKeyPlaceholder")
          : this.text("ip.keyPlaceholder");
    const prepareKeyEdit = (): void => {
      if (!draft.keyDirty && this.ipRiskSettings.hasApiKey) {
        draft.keyDirty = true;
        keyInput.value = "";
        keyInput.placeholder = this.text("ip.newKeyPlaceholder");
        keyInput.type = "password";
        draft.revealKey = false;
      }
      draft.apiKeyValue = keyInput.value;
    };
    keyInput.addEventListener("keydown", (event) => {
      if (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete") {
        prepareKeyEdit();
      }
    });
    keyInput.addEventListener("paste", prepareKeyEdit);
    keyInput.addEventListener("input", () => {
      draft.keyDirty = true;
      draft.apiKeyValue = keyInput.value;
      draft.revealKey = keyInput.type !== "password";
    });
    const syncDraft = (): void => {
      draft.enabled = enabledInput.checked;
      draft.apiKeyValue = keyInput.value;
      draft.revealKey = keyInput.type !== "password";
    };
    languageSelect.addEventListener("change", () => {
      syncDraft();
      const nextMode = languageModeFromValue(languageSelect.value);
      this.languageMode = nextMode;
      this.resolvedLanguage = resolveLanguage(nextMode);
      this.handlers.onLanguageModeSave?.(nextMode);
      this.render();
    });

    const reveal = this.renderActionButton(
      "👁",
      this.text("action.toggleSecret"),
      () => {
        keyInput.type = keyInput.type === "password" ? "text" : "password";
        draft.revealKey = keyInput.type !== "password";
      }
    );
    reveal.classList.add("settings-eye-button");
    keyInputWrap.append(keyInput, reveal);

    const actions = el("div", "settings-actions");
    const save = textEl(
      "button",
      "settings-button primary-button",
      this.text("settings.save")
    );
    save.type = "button";
    save.addEventListener("click", () => {
      draft.enabled = enabledInput.checked;
      draft.apiKeyValue = keyInput.value;
      const inputValue = draft.apiKeyValue.trim();
      const previewValue = this.ipRiskSettings.apiKeyPreview ?? "";
      this.handlers.onIpRiskSettingsSave?.({
        enabled: draft.enabled,
        apiKey:
          inputValue && inputValue !== previewValue ? inputValue : undefined
      });
      this.closeIpRiskSettingsDialog();
    });

    const refresh = textEl(
      "button",
      "settings-button",
      this.text("settings.checkNow")
    );
    refresh.type = "button";
    refresh.disabled =
      this.ipRiskRefreshing ||
      !this.ipRiskSettings.enabled ||
      !this.ipRiskSettings.hasApiKey;
    refresh.addEventListener("click", () => {
      this.handlers.onIpRiskRefresh?.();
      this.closeIpRiskSettingsDialog();
    });

    const remove = textEl(
      "button",
      "settings-button danger-button",
      this.text("ip.deleteKey")
    );
    remove.type = "button";
    remove.disabled = !this.ipRiskSettings.hasApiKey;
    remove.addEventListener("click", () => {
      this.handlers.onIpRiskSettingsSave?.({
        enabled: enabledInput.checked,
        clearApiKey: true
      });
      this.closeIpRiskSettingsDialog();
    });

    actions.append(save, refresh, remove);

    panel.append(
      header,
      textEl("label", "settings-label", this.text("language.label")),
      languageSelect,
      enabledLabel,
      textEl("label", "settings-label", this.text("ip.apiKeyLabel")),
      keyInputWrap,
      textEl("div", "settings-help", this.text("ip.help")),
      actions
    );
    return panel;
  }

  private ipRiskStatusText(): string {
    if (!this.ipRiskSettings.enabled) {
      return this.text("ip.status.disabled");
    }
    if (!this.ipRiskSettings.hasApiKey) {
      return this.text("ip.status.missingKey");
    }
    if (this.ipRiskRefreshing) {
      return this.text("ip.status.checking");
    }
    if (
      this.ipRiskSettings.enabled &&
      this.ipRiskSettings.hasApiKey &&
      this.ipRiskState?.status === "error"
    ) {
      return this.text("ip.status.failed");
    }
    const freshIpRisk = this.freshIpRiskState();
    if (freshIpRisk) {
      return `${formatRiskLabelLocalized(
        this.resolvedLanguage,
        freshIpRisk.label
      )} ${freshIpRisk.score}/100`;
    }
    return this.text("ip.status.waiting");
  }

  private freshIpRiskState(): (IpRiskState & { score: number }) | null {
    const state = this.ipRiskState;
    if (
      this.ipRiskSettings.enabled &&
      this.ipRiskSettings.hasApiKey &&
      state?.status === "ok" &&
      typeof state.score === "number"
    ) {
      return state as IpRiskState & { score: number };
    }
    return null;
  }

  private renderSentinelRow(label: string, value: string): HTMLElement {
    const row = el("div", "sentinel-row");
    row.append(textEl("span", "sentinel-label", label), textEl("span", "", value));
    return row;
  }

  private renderSentinelBar(score: number): HTMLElement {
    const bar = el("div", "bar sentinel-bar");
    const fill = el("div", `bar-fill sentinel-fill ${sentinelRiskClass(score)}`);
    const progress = clampPercent(score);
    fill.style.width = `${progress}%`;
    bar.style.setProperty("--meter-progress", `${progress}%`);
    bar.append(fill, decorativeAsset("leaf-small.png", "progress-leaf"));
    return bar;
  }

  private renderMeterSection(label: string, meters: UsageMeter[]): HTMLElement {
    const section = el("section", "meter-section");
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
    return this.renderActionButton("⚙", this.text("action.settings"), () => {
      this.ipRiskSettingsOpen = !this.ipRiskSettingsOpen;
      if (!this.ipRiskSettingsOpen) {
        this.ipRiskSettingsDraft = null;
      }
      this.render();
    });
  }

  private renderCollapsed(): HTMLElement {
    const button = el("button", "collapsed");
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
    return button;
  }

  private renderPanel(): HTMLElement {
    const panel = el("section", "panel");
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
        : this.snapshot?.cacheAgeMs !== undefined
          ? this.text("meta.cacheSeconds", {
              seconds: Math.floor(this.snapshot.cacheAgeMs / 1000)
            })
          : this.loading
            ? this.text("meta.loading")
            : "";
    meta.append(
      iconText("span", "meta-item", "leaf-small.png", updated),
      right ? iconText("span", "meta-item", "leaf-small.png", right) : textEl("span", "", "")
    );
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
    content.append(this.renderIpRiskSection());
    const meters = this.snapshot?.meters ?? [];
    if (meters.length === 0) {
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

    const bottom = el("div", "meter-bottom");
    const age = meter.observedAt
      ? ` · ${formatAgeLocalized(this.resolvedLanguage, meter.observedAt)}`
      : "";
    bottom.append(
      textEl(
        "span",
        "badge",
        `${formatSourceLabelLocalized(
          this.resolvedLanguage,
          meter.source
        )} · ${formatConfidenceLabelLocalized(
          this.resolvedLanguage,
          meter.confidence
        )}${age}`
      ),
      textEl("span", "", formatResetLocalized(this.resolvedLanguage, meter))
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

  private criticalSummary(): string {
    const meters = this.chatGptMeters();
    const alert = meters.find((meter) => typeof meter.remaining === "number" && meter.remaining <= 0)
      ?? meters.find((meter) => typeof meter.remainingPercent === "number" && meter.remainingPercent <= 5)
      ?? meters
        .filter((meter) => typeof meter.usedPercent === "number")
        .sort((a, b) => (b.usedPercent ?? 0) - (a.usedPercent ?? 0))[0]
      ?? meters
        .filter((meter) => typeof meter.remaining === "number")
        .sort((a, b) => (a.remaining ?? 0) - (b.remaining ?? 0))[0];
    if (!alert) {
      return formatStatusLabelLocalized(
        this.resolvedLanguage,
        this.snapshot?.status ?? "unknown"
      );
    }
    if (typeof alert.remainingPercent === "number") {
      return `${shortLabel(
        formatMeterLabelLocalized(this.resolvedLanguage, alert)
      )} ${this.text("meter.remainingPercent", {
        percent: Math.round(alert.remainingPercent)
      })}`;
    }
    if (typeof alert.usedPercent === "number") {
      return `${shortLabel(
        formatMeterLabelLocalized(this.resolvedLanguage, alert)
      )} ${Math.round(alert.usedPercent)}%`;
    }
    if (typeof alert.remaining === "number") {
      return `${shortLabel(
        formatMeterLabelLocalized(this.resolvedLanguage, alert)
      )} ${this.text("meter.remaining", { remaining: alert.remaining })}`;
    }
    return shortLabel(formatMeterLabelLocalized(this.resolvedLanguage, alert));
  }

  private chatGptMeters(): UsageMeter[] {
    const meters = [...(this.snapshot?.meters ?? [])];
    return meters.sort((a, b) => chatGptMeterPriority(a) - chatGptMeterPriority(b));
  }

  private chatGptPrimaryValue(): string {
    const meters = this.chatGptMeters();
    const alert = meters.find((meter) => typeof meter.remaining === "number" && meter.remaining <= 0)
      ?? meters.find((meter) => typeof meter.remainingPercent === "number" && meter.remainingPercent <= 5)
      ?? meters
        .filter((meter) => typeof meter.remaining === "number")
        .sort((a, b) => (a.remaining ?? 0) - (b.remaining ?? 0))[0]
      ?? meters
        .filter((meter) => typeof meter.remainingPercent === "number")
        .sort((a, b) => (a.remainingPercent ?? 0) - (b.remainingPercent ?? 0))[0]
      ?? meters.find((meter) => typeof meter.usedPercent === "number");
    return alert ? formatMeterValueLocalized(this.resolvedLanguage, alert) : "?";
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

function meterProgress(meter: UsageMeter): number {
  if (typeof meter.remainingPercent === "number") {
    return clampPercent(meter.remainingPercent);
  }
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

function sentinelRiskClass(score: number): string {
  if (score >= 75) {
    return "sentinel-risk-severe";
  }
  if (score >= 50) {
    return "sentinel-risk-high";
  }
  if (score >= 25) {
    return "sentinel-risk-elevated";
  }
  return "sentinel-risk-normal";
}

function formatIpRiskSignals(
  state: IpRiskState,
  language: ResolvedLanguage
): string {
  const signals: string[] = [];
  if (state.signals.proxy) {
    signals.push("Proxy");
  }
  if (state.signals.vpn) {
    signals.push("VPN");
  }
  if (state.signals.tor) {
    signals.push("Tor");
  }
  if (state.signals.hosting) {
    signals.push("Hosting");
  }
  if (state.signals.type && !signals.includes(state.signals.type)) {
    signals.push(state.signals.type);
  }
  return signals.length > 0 ? signals.join(" / ") : t(language, "ip.noProxySignals");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isAlertMeter(meter: UsageMeter): boolean {
  if (typeof meter.remaining === "number" && meter.remaining <= 0) {
    return true;
  }
  if (typeof meter.remainingPercent === "number" && meter.remainingPercent <= 5) {
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

function groupChatGptMeters(
  meters: UsageMeter[],
  language: ResolvedLanguage
): Array<{ label: string; meters: UsageMeter[] }> {
  const groups: Record<GptSectionKey, UsageMeter[]> = {
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
    label: formatGptSectionLabelLocalized(language, key),
    meters: groups[key]
  })).filter((section) => section.meters.length > 0);
}

function chatGptMeterSection(meter: UsageMeter): GptSectionKey {
  const key = meter.key.toLowerCase();
  const rawKind = meter.rawKind?.toLowerCase() ?? "";
  const label = meter.label.toLowerCase();

  if (
    key.includes("codex") ||
    rawKind === "codex.settings.usage" ||
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
  if (rawKind === "limits_progress" || key.startsWith("limits_progress:")) {
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
  if (meter.rawKind === "queries") {
    return 10;
  }
  if (meter.rawKind === "highEffortRateLimits") {
    return 20;
  }
  if (meter.rawKind === "lowEffortRateLimits") {
    return 30;
  }
  if (meter.rawKind === "tokens") {
    return 40;
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

function modelSummaryFromMeter(meter: UsageMeter): string | null {
  if (!meter.modelName) {
    return null;
  }
  if (meter.requestKind && meter.requestKind !== "DEFAULT") {
    return `${meter.modelName} · ${meter.requestKind}`;
  }
  return meter.modelName;
}

function assetUrl(name: NahidaAssetName): string {
  const path = `assets/nahida/${name}`;
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(path);
  }
  return path;
}

function decorativeAsset(name: NahidaAssetName, className: string): HTMLImageElement {
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
  assetName: NahidaAssetName
): HTMLElement {
  const title = el("div", className);
  title.append(
    decorativeAsset(assetName, "title-icon"),
    textEl("span", "title-text", label)
  );
  return title;
}

function sectionTitle(label: string, assetName: NahidaAssetName): HTMLElement {
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
  assetName: NahidaAssetName,
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

function platformTitleAsset(platform: PlatformId): NahidaAssetName {
  if (platform === "chatgpt") {
    return "clover-medallion.png";
  }
  if (platform === "claude") {
    return "leaf-emblem.png";
  }
  if (platform === "kimi") {
    return "leaf-emblem.png";
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
