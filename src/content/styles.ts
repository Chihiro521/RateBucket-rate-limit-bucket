export const WIDGET_CSS = `
:host {
  color-scheme: light dark;
  position: fixed;
  top: 50%;
  right: 12px;
  transform: translateY(-50%);
  z-index: 2147483000;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.35;
}

:host([data-platform="chatgpt"]) {
  top: clamp(12px, 4vh, 28px);
  right: clamp(10px, 2vw, 24px);
  transform: none;
}

* {
  box-sizing: border-box;
}

button {
  font: inherit;
}

.collapsed {
  min-width: 72px;
  height: 40px;
  border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, Canvas 92%, CanvasText 8%);
  color: CanvasText;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  display: grid;
  grid-template-columns: 8px 1fr;
  gap: 8px;
  align-items: center;
  padding: 6px 10px;
  cursor: pointer;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.gpt-restore-chip {
  min-width: 88px;
  min-height: 48px;
  border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, Canvas 94%, CanvasText 6%);
  color: CanvasText;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  display: grid;
  grid-template-columns: 8px 1fr;
  gap: 9px;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #9ca3af;
}

.status-ok {
  background: #315d86;
}

.status-partial {
  background: #f59e0b;
}

.status-error {
  background: #ef4444;
}

.collapsed-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.platform {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0;
}

.primary {
  font-size: 13px;
  font-weight: 650;
  white-space: nowrap;
}

.panel {
  width: min(320px, calc(100vw - 28px));
  border: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, Canvas 96%, CanvasText 4%);
  color: CanvasText;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}

.gpt-panel {
  width: min(400px, calc(100vw - 20px));
  height: min(560px, calc(100vh - 24px));
  min-height: 320px;
  border: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, Canvas 96%, CanvasText 4%);
  color: CanvasText;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.22);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.gpt-collapsed-panel {
  width: min(400px, calc(100vw - 20px));
  min-height: 48px;
  border: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, Canvas 96%, CanvasText 4%);
  color: CanvasText;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.22);
  display: grid;
  grid-template-columns: minmax(88px, 1fr) minmax(84px, auto) auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 10px 8px;
  border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
}

.gpt-header {
  flex: 0 0 auto;
  min-height: 58px;
}

.gpt-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.gpt-alerts {
  color: color-mix(in srgb, CanvasText 66%, transparent);
  font-size: 12px;
  white-space: nowrap;
}

.title {
  font-size: 14px;
  font-weight: 750;
}

.gpt-title {
  font-size: 18px;
  font-weight: 780;
  letter-spacing: 0;
  min-width: 0;
  white-space: nowrap;
}

.gpt-collapsed-summary {
  min-width: 0;
  color: color-mix(in srgb, CanvasText 76%, transparent);
  font-size: 13px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}

.actions {
  display: flex;
  gap: 6px;
}

.gpt-actions {
  flex: 0 0 auto;
}

.icon-button {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
  background: color-mix(in srgb, Canvas 90%, CanvasText 10%);
  color: CanvasText;
  cursor: pointer;
  display: grid;
  place-items: center;
}

.icon-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.meta {
  padding: 8px 10px;
  color: color-mix(in srgb, CanvasText 70%, transparent);
  font-size: 12px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.gpt-panel > .meta {
  flex: 0 0 auto;
  border-bottom: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
  padding: 9px 12px;
}

.model-meta {
  padding: 7px 10px 8px;
  border-top: 1px solid color-mix(in srgb, CanvasText 8%, transparent);
  border-bottom: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
  color: color-mix(in srgb, CanvasText 70%, transparent);
  font-size: 11px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}

.model-label {
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0;
}

.model-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}

.content {
  padding: 4px 10px 10px;
}

.gpt-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 12px 12px;
  scrollbar-width: none;
  scrollbar-color: transparent transparent;
}

.gpt-content:hover,
.gpt-content:focus-within {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, CanvasText 26%, transparent) transparent;
}

.gpt-content::-webkit-scrollbar {
  width: 0;
}

.gpt-content:hover::-webkit-scrollbar,
.gpt-content:focus-within::-webkit-scrollbar {
  width: 6px;
}

.gpt-content::-webkit-scrollbar-track {
  background: transparent;
}

.gpt-content::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, CanvasText 24%, transparent);
  border-radius: 999px;
}

.meter {
  padding: 8px 0;
  border-top: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
}

.gpt-content .meter {
  padding: 11px 0;
}

.meter-section {
  border-top: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
  padding: 8px 0 2px;
}

.meter-section:first-child {
  border-top: 0;
}

.meter-section-title {
  color: color-mix(in srgb, CanvasText 58%, transparent);
  font-size: 11px;
  font-weight: 760;
  letter-spacing: 0;
  padding: 3px 0 2px;
}

.meter-section .meter:first-of-type {
  border-top: 0;
}

.meter:first-child {
  border-top: 0;
}

.meter-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: baseline;
}

.meter-label {
  font-weight: 650;
  min-width: 0;
}

.meter-value {
  color: color-mix(in srgb, CanvasText 82%, transparent);
  white-space: nowrap;
}

.bar {
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, CanvasText 12%, transparent);
  overflow: hidden;
  margin-top: 7px;
}

.bar-fill {
  height: 100%;
  width: 0%;
  border-radius: inherit;
  background: #2563eb;
}

.bar-fill.remaining-fill {
  background: #3f5874;
}

.sentinel-block {
  padding: 7px 0 4px;
}

.sentinel-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: baseline;
  color: color-mix(in srgb, CanvasText 78%, transparent);
  font-size: 12px;
  padding: 2px 0;
}

.sentinel-label {
  color: color-mix(in srgb, CanvasText 60%, transparent);
  font-weight: 650;
}

.sentinel-bar {
  margin: 6px 0 7px;
}

.sentinel-risk-normal {
  background: #315d86;
}

.sentinel-risk-elevated {
  background: #f59e0b;
}

.sentinel-risk-high {
  background: #f97316;
}

.sentinel-risk-severe {
  background: #ef4444;
}

.sentinel-explanation {
  margin-top: 5px;
  color: color-mix(in srgb, CanvasText 64%, transparent);
  font-size: 11px;
  line-height: 1.4;
}

.error-text {
  color: #ef4444;
}

.settings-popover {
  position: fixed;
  top: clamp(12px, 5vh, 40px);
  right: clamp(10px, 2vw, 24px);
  width: min(360px, calc(100vw - 20px));
  border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, Canvas 98%, CanvasText 2%);
  color: CanvasText;
  box-shadow: 0 18px 54px rgba(0, 0, 0, 0.26);
  padding: 12px;
  z-index: 2147483001;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.settings-title {
  font-size: 14px;
  font-weight: 760;
}

.settings-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 650;
  margin: 4px 0 12px;
}

.settings-label {
  display: block;
  color: color-mix(in srgb, CanvasText 66%, transparent);
  font-size: 11px;
  font-weight: 650;
  margin-bottom: 5px;
}

.settings-input {
  width: 100%;
  height: 34px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  background: color-mix(in srgb, Canvas 96%, CanvasText 4%);
  color: CanvasText;
  padding: 6px 8px;
  outline: none;
}

.settings-popover > .settings-input {
  margin-bottom: 12px;
}

.settings-input-wrap {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  align-items: center;
  border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, Canvas 96%, CanvasText 4%);
  overflow: hidden;
}

.settings-input-wrap .settings-input {
  border: 0;
  border-radius: 0;
  background: transparent;
}

.settings-eye-button {
  width: 34px;
  height: 34px;
  border: 0;
  border-left: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.settings-input:focus {
  border-color: #2563eb;
}

.settings-input-wrap:focus-within {
  border-color: #2563eb;
}

.settings-help {
  margin-top: 8px;
  color: color-mix(in srgb, CanvasText 62%, transparent);
  font-size: 11px;
  line-height: 1.45;
}

.settings-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.settings-button {
  min-height: 30px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
  background: color-mix(in srgb, Canvas 90%, CanvasText 10%);
  color: CanvasText;
  cursor: pointer;
  padding: 5px 10px;
}

.settings-button:disabled {
  opacity: 0.52;
  cursor: not-allowed;
}

.primary-button {
  border-color: color-mix(in srgb, #2563eb 65%, CanvasText 10%);
  background: #2563eb;
  color: white;
}

.danger-button {
  color: #ef4444;
}

.meter-bottom {
  margin-top: 6px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  color: color-mix(in srgb, CanvasText 66%, transparent);
  font-size: 11px;
}

.badge {
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, CanvasText 13%, transparent);
  padding: 1px 6px;
  background: color-mix(in srgb, Canvas 88%, CanvasText 12%);
}

.empty,
.error {
  padding: 12px 0;
  color: color-mix(in srgb, CanvasText 72%, transparent);
}

.error {
  color: #ef4444;
}

/* Cold blue capsule shell. Keeps the widget DOM stable while replacing the visual skin. */
:host {
  color-scheme: light;
  --rb-ink: #253244;
  --rb-ink-soft: #405063;
  --rb-blue: #25364d;
  --rb-blue-deep: #1d2b3f;
  --rb-blue-soft: #3f5874;
  --rb-blue-pale: #8fa8c4;
  --rb-paper: #fbf5eb;
  --rb-paper-soft: #f4ebdd;
  --rb-paper-warm: #fffaf1;
  --rb-brown: #70675d;
  --rb-brown-soft: #b7aa99;
  --rb-line: rgba(111, 101, 89, 0.38);
  --rb-line-strong: rgba(35, 50, 70, 0.72);
  --rb-mustard: #d4a644;
  --rb-mustard-deep: #b98225;
  --rb-red: #b85a4a;
  --rb-shadow: 0 18px 42px rgba(25, 34, 46, 0.24);
  --rb-soft-shadow: 0 9px 22px rgba(37, 45, 56, 0.16);
  --rb-inner: inset 0 0 0 1px rgba(255, 255, 255, 0.76);
  color: var(--rb-ink);
}

.panel,
.gpt-panel,
.gpt-collapsed-panel,
.settings-popover {
  border: 1px solid var(--rb-line);
  background:
    linear-gradient(180deg, rgba(255, 252, 246, 0.98), rgba(246, 238, 225, 0.96)),
    repeating-linear-gradient(90deg, rgba(63, 88, 116, 0.03) 0 1px, transparent 1px 28px);
  color: var(--rb-ink);
  box-shadow: var(--rb-shadow), var(--rb-inner);
}

.panel,
.gpt-panel,
.gpt-collapsed-panel {
  position: relative;
  overflow: hidden;
}

.panel,
.gpt-panel {
  border-radius: 18px;
}

.panel {
  width: min(314px, calc(100vw - 24px));
  padding-bottom: 18px;
}

.gpt-panel {
  width: min(390px, calc(100vw - 16px));
  height: min(552px, calc(100vh - 16px));
  min-height: 380px;
}

.settings-popover {
  border-radius: 16px;
  padding: 0 12px 12px;
}

.panel::before,
.gpt-panel::before,
.settings-popover::before {
  content: "";
  display: block;
  height: 4px;
  background: linear-gradient(90deg, transparent, rgba(143, 168, 196, 0.7), rgba(212, 166, 68, 0.78), rgba(143, 168, 196, 0.7), transparent);
}

.panel::after,
.gpt-panel::after {
  content: "";
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 20px;
  border-top: 1px solid rgba(255, 250, 241, 0.24);
  background:
    radial-gradient(circle at 22px 50%, var(--rb-mustard) 0 5px, transparent 6px),
    radial-gradient(circle at 46px 50%, #f0d78a 0 4px, transparent 5px),
    radial-gradient(circle at 70px 50%, var(--rb-blue-pale) 0 4px, transparent 5px),
    linear-gradient(180deg, var(--rb-blue), var(--rb-blue-deep));
  pointer-events: none;
  z-index: 0;
}

.header,
.meta,
.model-meta,
.content,
.gpt-content,
.vine-divider,
.settings-header,
.settings-check,
.settings-label,
.settings-input-wrap,
.settings-help,
.settings-actions,
.sentinel-block,
.meter,
.meter-section {
  position: relative;
  z-index: 1;
}

.header {
  min-height: 52px;
  padding: 10px 12px 9px;
  border-bottom-color: rgba(112, 103, 93, 0.22);
  background:
    linear-gradient(180deg, rgba(255, 250, 241, 0.9), rgba(244, 235, 221, 0.72)),
    linear-gradient(90deg, rgba(63, 88, 116, 0.12), transparent 52%, rgba(212, 166, 68, 0.12));
}

.header::after {
  content: "";
  position: absolute;
  right: 14px;
  bottom: -1px;
  left: 14px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(112, 103, 93, 0.58), rgba(212, 166, 68, 0.56), transparent);
}

.title,
.gpt-title,
.settings-title,
.meter-section-title {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: var(--rb-ink);
  font-weight: 780;
  letter-spacing: 0;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.9);
}

.title::before,
.gpt-title::before,
.settings-title::before,
.meter-section-title::before {
  content: none;
}

.title-text,
.section-title-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title-icon,
.section-title-icon,
.inline-icon,
.section-badge,
.progress-leaf,
.chip-icon,
.vine-divider-image,
.corner,
.card-corner {
  display: block;
  object-fit: contain;
  user-select: none;
  -webkit-user-select: none;
}

.title-icon {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  filter: drop-shadow(0 2px 4px rgba(31, 43, 59, 0.18));
}

.gpt-title .title-icon {
  width: 25px;
  height: 25px;
  flex-basis: 25px;
}

.settings-title .title-icon {
  width: 20px;
  height: 20px;
  flex-basis: 20px;
}

.gpt-alerts,
.gpt-collapsed-summary,
.meta,
.model-meta,
.sentinel-row,
.meter-bottom,
.settings-help {
  color: var(--rb-brown);
}

.gpt-alerts {
  padding: 3px 8px;
  border: 1px solid rgba(112, 103, 93, 0.28);
  border-radius: 999px;
  background: rgba(255, 250, 241, 0.7);
  font-size: 11px;
  box-shadow: var(--rb-inner);
}

.icon-button,
.settings-button {
  border: 1px solid rgba(112, 103, 93, 0.38);
  background: linear-gradient(145deg, rgba(255, 250, 241, 0.98), rgba(239, 230, 215, 0.9));
  color: var(--rb-blue);
  box-shadow: 0 2px 8px rgba(38, 48, 62, 0.13), var(--rb-inner);
}

.icon-button {
  width: 28px;
  height: 28px;
  border-radius: 10px;
}

.icon-button:hover,
.settings-button:hover {
  border-color: rgba(63, 88, 116, 0.62);
  background: linear-gradient(145deg, #fffdf7, #e9edf1);
  transform: translateY(-1px);
}

.icon-button:active,
.settings-button:active {
  transform: translateY(0);
  box-shadow: inset 0 2px 5px rgba(38, 48, 62, 0.16);
}

.icon-button:disabled,
.settings-button:disabled {
  color: rgba(64, 80, 99, 0.44);
  box-shadow: none;
}

.primary-button {
  border-color: rgba(37, 54, 77, 0.72);
  background: linear-gradient(145deg, var(--rb-blue-soft), var(--rb-blue));
  color: var(--rb-paper-warm);
}

.danger-button,
.error,
.error-text {
  color: var(--rb-red);
}

.collapsed,
.gpt-restore-chip {
  position: relative;
  width: min(172px, calc(100vw - 14px));
  min-width: 160px;
  height: 44px;
  min-height: 44px;
  grid-template-columns: 78px 7px minmax(0, 1fr);
  gap: 3px;
  align-items: center;
  overflow: visible;
  border: 1.5px solid var(--rb-line-strong);
  border-radius: 999px;
  background:
    linear-gradient(90deg, var(--rb-blue) 0 46px, transparent 46px),
    linear-gradient(180deg, var(--rb-paper-warm), var(--rb-paper-soft));
  color: var(--rb-ink);
  box-shadow: var(--rb-soft-shadow), var(--rb-inner);
  padding: 0 7px 0 6px;
}

.collapsed::before,
.gpt-restore-chip::before {
  content: "";
  position: absolute;
  top: 5px;
  bottom: 5px;
  left: 5px;
  width: 36px;
  border-radius: 999px 7px 7px 999px;
  background: linear-gradient(145deg, #344963, var(--rb-blue-deep));
  box-shadow:
    inset 0 0 0 1px rgba(255, 249, 237, 0.28),
    inset -8px 0 14px rgba(8, 17, 30, 0.18);
  pointer-events: none;
}

.collapsed::after,
.gpt-restore-chip::after {
  content: "";
  position: absolute;
  top: 8px;
  left: 11px;
  z-index: 1;
  width: 30px;
  height: 28px;
  border-radius: 999px;
  background:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpolygon fill='%23fffaf1' points='8,0 10.3,5.3 16,6 11.7,9.8 12.9,16 8,12.8 3.1,16 4.3,9.8 0,6 5.7,5.3'/%3E%3C/svg%3E") 3px 18px / 9px 9px no-repeat,
    radial-gradient(circle at 8px 7px, var(--rb-paper-warm) 0 4px, transparent 5px),
    radial-gradient(circle at 19px 20px, var(--rb-mustard) 0 3px, transparent 4px),
    radial-gradient(circle at 27px 8px, #c5cbd0 0 3px, transparent 4px);
  pointer-events: none;
}

.collapsed:hover,
.gpt-restore-chip:hover {
  border-color: rgba(35, 50, 70, 0.86);
  background:
    linear-gradient(90deg, #2d405a 0 46px, transparent 46px),
    linear-gradient(180deg, #fffdf7, #f1e9db);
  transform: translateY(-1px);
}

.chip-icon {
  position: absolute;
  top: 50%;
  left: 32px;
  z-index: 2;
  width: 14px;
  height: 14px;
  opacity: 0;
  transform: translateY(-50%);
  filter: drop-shadow(0 1px 2px rgba(10, 18, 30, 0.34));
}

.status-dot {
  position: relative;
  z-index: 3;
  grid-column: 2;
  justify-self: center;
  width: 7px;
  height: 7px;
  box-shadow: 0 0 0 1.5px rgba(255, 250, 241, 0.88);
}

.status-ok {
  background: var(--rb-blue-soft);
}

.status-partial {
  background: var(--rb-mustard);
}

.status-error {
  background: var(--rb-red);
}

.collapsed-main {
  position: relative;
  z-index: 2;
  display: grid;
  grid-column: 3;
  grid-template-columns: minmax(0, 1fr) 1px auto;
  column-gap: 4px;
  align-items: center;
  min-width: 0;
  padding-left: 0;
}

.collapsed-main::before {
  content: "";
  grid-column: 2;
  grid-row: 1;
  width: 1px;
  height: 22px;
  background: rgba(125, 114, 99, 0.34);
}

.platform {
  grid-column: 1;
  grid-row: 1;
  color: var(--rb-ink-soft);
  overflow: hidden;
  font-size: 10px;
  font-weight: 760;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.primary {
  grid-column: 3;
  grid-row: 1;
  color: var(--rb-ink);
  font-size: 11px;
  font-weight: 780;
  text-align: right;
}

.capsule-mascot {
  position: absolute;
  left: 72px;
  bottom: -22px;
  z-index: 5;
  width: 166px;
  height: auto;
  max-width: none;
  object-fit: contain;
  object-position: center bottom;
  pointer-events: none;
  transform: translateX(-50%);
  filter: drop-shadow(0 6px 9px rgba(24, 33, 44, 0.24));
}

.gpt-collapsed-panel {
  width: min(392px, calc(100vw - 16px));
  min-height: 64px;
  grid-template-columns: minmax(118px, auto) minmax(68px, 1fr) auto;
  gap: 9px;
  align-items: center;
  border-radius: 999px;
  overflow: visible;
  padding: 8px 12px 8px 118px;
  background:
    linear-gradient(90deg, var(--rb-blue) 0 96px, transparent 96px),
    linear-gradient(180deg, var(--rb-paper-warm), var(--rb-paper-soft));
}

.gpt-collapsed-panel .capsule-mascot {
  left: 82px;
  bottom: -7px;
  width: 112px;
}

.gpt-collapsed-panel .gpt-title {
  font-size: 15px;
}

.gpt-collapsed-panel .title-icon {
  width: 20px;
  height: 20px;
  flex-basis: 20px;
}

.gpt-collapsed-summary {
  font-size: 12px;
}

.meta,
.gpt-panel > .meta,
.model-meta {
  border-color: rgba(112, 103, 93, 0.2);
  background: rgba(255, 250, 241, 0.58);
}

.meta {
  padding: 8px 12px;
  font-size: 11px;
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.inline-icon {
  width: 12px;
  height: 12px;
  flex: 0 0 12px;
}

.vine-divider {
  height: 16px;
  margin: 0 12px 2px;
  display: grid;
  place-items: center;
  overflow: hidden;
}

.panel .vine-divider {
  height: 12px;
  margin-inline: 10px;
}

.vine-divider-image {
  width: 100%;
  height: 100%;
  opacity: 0.68;
}

.content {
  padding: 6px 10px 20px;
}

.gpt-content {
  padding: 0 10px 28px;
  background:
    radial-gradient(circle at 50% 0%, rgba(143, 168, 196, 0.2), transparent 34%),
    linear-gradient(180deg, rgba(255, 250, 241, 0.58), rgba(246, 238, 225, 0.62));
  scrollbar-width: thin;
  scrollbar-color: rgba(63, 88, 116, 0.32) transparent;
}

.gpt-content::-webkit-scrollbar,
.gpt-content:hover::-webkit-scrollbar,
.gpt-content:focus-within::-webkit-scrollbar {
  width: 6px;
}

.gpt-content::-webkit-scrollbar-thumb {
  background: rgba(63, 88, 116, 0.32);
}

.panel-corners,
.card-corners {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.corner {
  position: absolute;
  width: 34px;
  height: 34px;
  opacity: 0.48;
}

.compact-corners .corner {
  width: 26px;
  height: 26px;
  opacity: 0.34;
}

.corner-top-left {
  top: 3px;
  left: 3px;
}

.corner-top-right {
  top: 3px;
  right: 3px;
}

.corner-bottom-left {
  bottom: 21px;
  left: 3px;
}

.corner-bottom-right {
  right: 3px;
  bottom: 21px;
}

.meter-section {
  margin-top: 9px;
  padding: 10px 12px 10px;
  border: 1px solid rgba(112, 103, 93, 0.28);
  border-radius: 12px;
  background:
    linear-gradient(180deg, rgba(255, 253, 247, 0.92), rgba(247, 239, 225, 0.82)),
    radial-gradient(circle at 100% 0%, rgba(143, 168, 196, 0.16), transparent 32%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.62), 0 7px 16px rgba(37, 45, 56, 0.08);
  overflow: hidden;
}

.meter-section::before {
  content: "";
  position: absolute;
  inset: 5px;
  border: 1px solid rgba(112, 103, 93, 0.12);
  border-radius: 8px;
  pointer-events: none;
  z-index: 0;
}

.meter-section::after {
  content: none;
}

.meter-section-title {
  position: relative;
  z-index: 1;
  padding: 1px 30px 7px 0;
  color: var(--rb-ink);
  font-size: 13px;
}

.meter-section-title::after {
  content: "";
  height: 1px;
  min-width: 24px;
  flex: 1 1 auto;
  background: linear-gradient(90deg, rgba(63, 88, 116, 0.35), rgba(212, 166, 68, 0.24), transparent);
}

.section-title-icon {
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
}

.section-badge {
  position: absolute;
  top: 9px;
  right: 10px;
  width: 24px;
  height: 24px;
  z-index: 1;
  opacity: 0.9;
  filter: drop-shadow(0 3px 5px rgba(31, 43, 59, 0.16));
}

.shield-badge {
  top: 27px;
  width: 36px;
  height: 36px;
}

.ip-risk-block {
  padding-right: 48px;
}

.card-corners {
  opacity: 0.34;
}

.card-corner {
  position: absolute;
  width: 18px;
  height: 18px;
  opacity: 0.48;
}

.card-corner-top-left {
  top: 3px;
  left: 3px;
}

.card-corner-bottom-right {
  display: none;
}

.meter,
.gpt-content .meter {
  padding: 9px 0;
  border-top-color: rgba(112, 103, 93, 0.18);
  border-radius: 8px;
}

.meter:hover {
  background: rgba(143, 168, 196, 0.12);
}

.meter-label {
  color: var(--rb-ink);
  font-weight: 760;
}

.meter-value {
  color: var(--rb-blue);
  font-weight: 760;
}

.bar {
  position: relative;
  height: 8px;
  margin-top: 8px;
  overflow: visible;
  border: 1px solid rgba(112, 103, 93, 0.2);
  background: linear-gradient(180deg, #e9dfd0, #f6eee2);
  box-shadow: inset 0 1px 2px rgba(54, 72, 94, 0.12);
}

.bar-fill {
  position: relative;
  background: linear-gradient(90deg, var(--rb-blue), var(--rb-blue-soft));
  box-shadow: 0 0 8px rgba(63, 88, 116, 0.24);
}

.bar-fill.remaining-fill {
  background: linear-gradient(90deg, var(--rb-blue-soft), var(--rb-mustard));
}

.bar-fill::after {
  content: none;
}

.progress-leaf {
  position: absolute;
  top: 50%;
  left: clamp(7px, var(--meter-progress), calc(100% - 7px));
  width: 14px;
  height: 14px;
  transform: translate(-50%, -50%);
  filter: drop-shadow(0 1px 2px rgba(31, 43, 59, 0.28));
  pointer-events: none;
}

.sentinel-risk-normal {
  background: linear-gradient(90deg, var(--rb-blue), var(--rb-blue-soft));
}

.sentinel-risk-elevated {
  background: linear-gradient(90deg, var(--rb-mustard-deep), var(--rb-mustard));
}

.sentinel-risk-high {
  background: linear-gradient(90deg, #b56a33, #e0a24d);
}

.sentinel-risk-severe {
  background: linear-gradient(90deg, #9f463e, var(--rb-red));
}

.sentinel-label {
  color: var(--rb-ink-soft);
}

.sentinel-explanation {
  color: var(--rb-brown);
}

.badge {
  border-color: rgba(112, 103, 93, 0.28);
  background: linear-gradient(180deg, rgba(255, 250, 241, 0.96), rgba(239, 230, 215, 0.86));
  color: var(--rb-blue);
  box-shadow: var(--rb-inner);
}

.badge::before {
  content: "•";
  margin-right: 4px;
  color: var(--rb-blue-soft);
}

.settings-header {
  padding: 10px 0 9px;
  border-bottom: 1px solid rgba(112, 103, 93, 0.22);
}

.settings-check {
  color: var(--rb-ink);
}

.settings-input-wrap,
.settings-input {
  border-color: rgba(112, 103, 93, 0.34);
  background: rgba(255, 250, 241, 0.86);
  color: var(--rb-ink);
}

.settings-input::placeholder {
  color: rgba(112, 103, 93, 0.62);
}

.settings-input-wrap:focus-within,
.settings-input:focus {
  border-color: rgba(63, 88, 116, 0.76);
}

.settings-eye-button {
  box-shadow: none;
}

.empty {
  color: var(--rb-brown);
}

@media (max-width: 480px) {
  .collapsed,
  .gpt-restore-chip {
    width: min(160px, calc(100vw - 12px));
    min-width: 152px;
    height: 42px;
    min-height: 42px;
    grid-template-columns: 72px 7px minmax(0, 1fr);
    gap: 3px;
    background:
      linear-gradient(90deg, var(--rb-blue) 0 42px, transparent 42px),
      linear-gradient(180deg, var(--rb-paper-warm), var(--rb-paper-soft));
    padding: 0 6px 0 5px;
  }

  .collapsed::before,
  .gpt-restore-chip::before {
    width: 32px;
  }

  .collapsed::after,
  .gpt-restore-chip::after {
    left: 10px;
    transform: scale(0.76);
    transform-origin: left center;
  }

  .collapsed:hover,
  .gpt-restore-chip:hover {
    background:
      linear-gradient(90deg, #2d405a 0 42px, transparent 42px),
      linear-gradient(180deg, #fffdf7, #f1e9db);
  }

  .collapsed-main {
    column-gap: 3px;
  }

  .collapsed-main::before {
    height: 20px;
  }

  .platform {
    font-size: 9px;
  }

  .primary {
    font-size: 10px;
  }

  .capsule-mascot {
    left: 66px;
    bottom: -20px;
    width: 154px;
  }

  .gpt-panel {
    width: min(370px, calc(100vw - 12px));
    height: min(536px, calc(100vh - 14px));
  }

  .gpt-collapsed-panel {
    width: min(350px, calc(100vw - 12px));
    min-height: 62px;
    grid-template-columns: minmax(96px, auto) minmax(42px, 1fr) auto;
    padding-left: 104px;
  }

  .gpt-collapsed-panel .capsule-mascot {
    left: 76px;
    width: 102px;
  }

  .gpt-alerts {
    display: none;
  }
}
`;
