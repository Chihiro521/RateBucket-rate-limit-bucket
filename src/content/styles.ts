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
  background: #10b981;
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
  background: #22c55e;
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
  background: #22c55e;
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

/* Botanical ivory theme, inspired by a green fantasy dashboard without copying source art. */
:host {
  color-scheme: light;
  --aiqm-paper: #fffdf3;
  --aiqm-paper-soft: #f8f3dc;
  --aiqm-paper-warm: #fff8df;
  --aiqm-ink: #31461f;
  --aiqm-muted: #7b7a64;
  --aiqm-leaf: #6f9c37;
  --aiqm-leaf-dark: #3c661d;
  --aiqm-leaf-soft: #dbeaba;
  --aiqm-gold: #c8a94f;
  --aiqm-gold-soft: #efe2a7;
  --aiqm-line: rgba(139, 157, 79, 0.34);
  --aiqm-shadow: 0 18px 42px rgba(56, 71, 36, 0.24);
  --aiqm-glow: 0 0 18px rgba(157, 206, 89, 0.18);
  color: var(--aiqm-ink);
}

.panel,
.gpt-panel,
.gpt-collapsed-panel,
.settings-popover {
  border: 1px solid rgba(151, 132, 62, 0.58);
  background:
    radial-gradient(circle at 18% 0%, rgba(205, 234, 148, 0.24), transparent 34%),
    radial-gradient(circle at 100% 16%, rgba(235, 210, 112, 0.18), transparent 28%),
    linear-gradient(135deg, rgba(255, 255, 248, 0.96), rgba(252, 247, 224, 0.96)),
    repeating-linear-gradient(45deg, rgba(126, 154, 58, 0.045) 0 1px, transparent 1px 12px);
  color: var(--aiqm-ink);
  box-shadow: var(--aiqm-shadow), var(--aiqm-glow), inset 0 0 0 1px rgba(255, 255, 255, 0.78);
}

.gpt-panel::before,
.panel::before,
.gpt-collapsed-panel::before,
.settings-popover::before {
  content: "";
  display: block;
  height: 4px;
  background: linear-gradient(90deg, transparent, var(--aiqm-leaf-soft), var(--aiqm-gold-soft), var(--aiqm-leaf-soft), transparent);
}

.gpt-panel::before,
.panel::before {
  flex: 0 0 auto;
}

.gpt-collapsed-panel::before {
  display: none;
}

.collapsed,
.gpt-restore-chip {
  border: 1px solid rgba(151, 132, 62, 0.54);
  background: linear-gradient(145deg, #fffdf4, #f1f7df);
  color: var(--aiqm-ink);
  box-shadow: 0 12px 30px rgba(54, 74, 34, 0.22);
}

.collapsed:hover,
.gpt-restore-chip:hover {
  border-color: rgba(111, 156, 55, 0.7);
  background: linear-gradient(145deg, #fffffa, #e8f4cf);
}

.status-dot {
  background: #9ca67f;
  box-shadow: 0 0 0 2px rgba(255, 250, 224, 0.9);
}

.status-ok {
  background: #70a742;
}

.status-partial {
  background: #c99a2c;
}

.status-error {
  background: #d65a3f;
}

.header {
  background:
    linear-gradient(180deg, rgba(255, 253, 243, 0.98), rgba(246, 242, 217, 0.92)),
    linear-gradient(90deg, rgba(118, 154, 60, 0.08), transparent 35%, rgba(200, 169, 79, 0.12));
  border-bottom: 1px solid var(--aiqm-line);
  position: relative;
}

.header::after {
  content: "";
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: -1px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(111, 156, 55, 0.58), rgba(200, 169, 79, 0.62), transparent);
}

.title,
.gpt-title,
.settings-title {
  color: var(--aiqm-leaf-dark);
  font-family: Georgia, "Times New Roman", ui-serif, serif;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.9);
}

.title::before,
.gpt-title::before,
.settings-title::before {
  content: "✥";
  color: var(--aiqm-leaf);
  margin-right: 7px;
  font-family: Georgia, "Times New Roman", ui-serif, serif;
}

.gpt-alerts,
.gpt-collapsed-summary,
.meta,
.model-meta,
.sentinel-row,
.meter-bottom,
.settings-help {
  color: var(--aiqm-muted);
}

.gpt-alerts {
  border: 1px solid rgba(151, 132, 62, 0.28);
  border-radius: 999px;
  background: rgba(255, 252, 234, 0.72);
  padding: 4px 8px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.54);
}

.icon-button,
.settings-button {
  border: 1px solid rgba(151, 132, 62, 0.45);
  background: linear-gradient(145deg, #fffdf5, #eff6dc);
  color: var(--aiqm-leaf-dark);
  box-shadow: 0 2px 8px rgba(70, 87, 45, 0.14), inset 0 0 0 1px rgba(255, 255, 255, 0.62);
}

.icon-button:hover,
.settings-button:hover {
  border-color: rgba(111, 156, 55, 0.72);
  background: linear-gradient(145deg, #fffef8, #e9f3cf);
  transform: translateY(-1px);
}

.icon-button:active,
.settings-button:active {
  transform: translateY(0);
  box-shadow: inset 0 2px 5px rgba(54, 74, 34, 0.16);
}

.icon-button:disabled,
.settings-button:disabled {
  color: rgba(49, 70, 31, 0.46);
  box-shadow: none;
}

.primary-button {
  border-color: rgba(92, 126, 38, 0.74);
  background: linear-gradient(145deg, #83b747, #4f8127);
  color: #fffdf3;
}

.danger-button {
  color: #c94432;
}

.gpt-panel > .meta,
.model-meta {
  border-color: var(--aiqm-line);
  background: rgba(255, 252, 234, 0.62);
}

.gpt-content {
  background:
    radial-gradient(circle at 50% 0%, rgba(230, 243, 190, 0.26), transparent 36%),
    linear-gradient(180deg, rgba(255, 253, 243, 0.78), rgba(251, 246, 224, 0.78)),
    repeating-linear-gradient(90deg, transparent 0 28px, rgba(111, 156, 55, 0.035) 28px 29px);
}

.gpt-content::-webkit-scrollbar-thumb {
  background: rgba(95, 122, 54, 0.32);
}

.meter-section {
  border: 1px solid rgba(151, 132, 62, 0.28);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 254, 248, 0.86), rgba(251, 247, 224, 0.74)),
    radial-gradient(circle at 100% 0%, rgba(204, 229, 145, 0.16), transparent 30%);
  margin-top: 10px;
  padding: 9px 12px 8px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.62);
  position: relative;
}

.meter-section::after {
  content: "";
  position: absolute;
  left: 50%;
  top: -5px;
  width: 18px;
  height: 9px;
  border: 1px solid rgba(151, 132, 62, 0.28);
  border-bottom: 0;
  border-radius: 14px 14px 0 0;
  background: linear-gradient(180deg, #fffdf4, #edf5d6);
  transform: translateX(-50%);
}

.meter-section:first-child {
  border-top: 1px solid rgba(151, 132, 62, 0.28);
}

.meter-section-title {
  color: var(--aiqm-leaf-dark);
  font-size: 13px;
  font-family: Georgia, "Times New Roman", ui-serif, serif;
  display: flex;
  align-items: center;
  gap: 5px;
}

.meter-section-title::before {
  content: "✦";
  color: var(--aiqm-leaf);
  margin-right: 1px;
}

.meter-section-title::after {
  content: "";
  height: 1px;
  flex: 1 1 auto;
  background: linear-gradient(90deg, rgba(111, 156, 55, 0.34), transparent);
}

.meter,
.gpt-content .meter {
  border-top: 1px solid rgba(151, 132, 62, 0.18);
  border-radius: 7px;
}

.meter:hover {
  background: rgba(236, 246, 207, 0.34);
}

.meter-label {
  color: #263c18;
  font-weight: 760;
}

.meter-value {
  color: var(--aiqm-leaf-dark);
  font-weight: 740;
}

.bar {
  height: 7px;
  background: #e6ecd4;
  border: 1px solid rgba(120, 141, 70, 0.22);
  box-shadow: inset 0 1px 2px rgba(66, 82, 43, 0.12);
  overflow: visible;
}

.bar-fill {
  position: relative;
  background: linear-gradient(90deg, #8cbf49, #d3bd55);
  box-shadow: 0 0 8px rgba(132, 181, 73, 0.22);
}

.bar-fill.remaining-fill {
  background: linear-gradient(90deg, #79ad3f, #bddc68);
}

.bar-fill::after {
  content: "";
  position: absolute;
  top: 50%;
  right: -4px;
  width: 8px;
  height: 8px;
  border-radius: 2px 8px 2px 8px;
  background: linear-gradient(135deg, #f8ed9b, #76a93e);
  border: 1px solid rgba(90, 110, 42, 0.38);
  transform: translateY(-50%) rotate(18deg);
  box-shadow: 0 0 6px rgba(146, 194, 76, 0.35);
}

.sentinel-risk-normal {
  background: linear-gradient(90deg, #77ad3f, #bdda65);
}

.sentinel-risk-elevated {
  background: linear-gradient(90deg, #d8b83d, #f0d56c);
}

.sentinel-risk-high {
  background: linear-gradient(90deg, #df8b2d, #f2c15c);
}

.sentinel-risk-severe {
  background: linear-gradient(90deg, #cf4e3a, #ed8f68);
}

.sentinel-label {
  color: #667747;
}

.sentinel-explanation {
  color: #81745f;
}

.badge {
  border-color: rgba(151, 132, 62, 0.3);
  background: linear-gradient(180deg, #fffdf2, #eef5d8);
  color: #60743f;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.58);
}

.settings-popover {
  padding: 0 12px 12px;
}

.settings-header {
  border-bottom: 1px solid var(--aiqm-line);
  padding: 10px 0 9px;
}

.settings-check {
  color: var(--aiqm-leaf-dark);
}

.settings-input-wrap,
.settings-input {
  border-color: rgba(151, 132, 62, 0.34);
  background: rgba(255, 253, 244, 0.86);
  color: var(--aiqm-ink);
}

.settings-input::placeholder {
  color: rgba(92, 105, 63, 0.58);
}

.settings-actions {
  justify-content: flex-start;
}

.settings-input-wrap:focus-within,
.settings-input:focus {
  border-color: rgba(111, 156, 55, 0.78);
}

.settings-eye-button {
  box-shadow: none;
}

.empty {
  color: var(--aiqm-muted);
}

.error,
.error-text {
  color: #c94432;
}

@media (max-width: 480px) {
  .gpt-panel {
    width: min(380px, calc(100vw - 16px));
    height: min(540px, calc(100vh - 18px));
  }

  .gpt-title {
    font-size: 16px;
  }

  .gpt-alerts {
    display: none;
  }

  .meter-section {
    padding-inline: 10px;
  }
}

/* Nahida Style Capsule */
.nahida-capsule {
  display: flex;
  align-items: center;
  background: var(--aiqm-paper);
  border: 1px solid var(--aiqm-gold);
  border-radius: 999px;
  padding: 4px 16px 4px 6px;
  position: relative;
  box-shadow: 0 6px 16px rgba(56, 71, 36, 0.15), inset 0 0 0 1px rgba(255, 255, 255, 0.8);
  min-width: 160px;
  height: 52px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  user-select: none;
  border-bottom-width: 2px;
}

.nahida-capsule:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(56, 71, 36, 0.2), inset 0 0 0 1px rgba(255, 255, 255, 0.9);
  border-color: var(--aiqm-leaf);
}

.nahida-avatar-wrap {
  position: relative;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  margin-right: 10px;
  z-index: 2;
}

.nahida-avatar {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  border: 2.5px solid var(--aiqm-gold-soft);
  background: white;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
}

.nahida-avatar-border {
  position: absolute;
  top: -3px;
  left: -3px;
  right: -3px;
  bottom: -3px;
  border-radius: 50%;
  border: 1px solid var(--aiqm-leaf-soft);
  pointer-events: none;
}

.nahida-content {
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex: 1;
  min-width: 0;
}

.nahida-platform {
  font-family: Georgia, serif;
  font-size: 11px;
  font-weight: 800;
  color: var(--aiqm-leaf-dark);
  text-align: center;
  letter-spacing: 2px;
  opacity: 0.85;
  margin-bottom: -1px;
}

.nahida-value-row {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
}

.nahida-label {
  font-size: 11px;
  color: var(--aiqm-muted);
  font-weight: 600;
}

.nahida-value {
  font-size: 18px;
  font-weight: 850;
  color: var(--aiqm-ink);
  font-family: Inter, sans-serif;
  white-space: nowrap;
}

/* Decorative Leaves */
.nahida-leaf {
  position: absolute;
  width: 14px;
  height: 14px;
  background: var(--aiqm-leaf);
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M17,8C8,10 5,16 5,16C5,16 11,13 20,15C20,15 18,11 17,8Z' /%3E%3C/svg%3E");
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M17,8C8,10 5,16 5,16C5,16 11,13 20,15C20,15 18,11 17,8Z' /%3E%3C/svg%3E");
  mask-repeat: no-repeat;
  -webkit-mask-repeat: no-repeat;
  z-index: 1;
}

.nahida-leaf-left {
  left: -6px;
  top: 50%;
  transform: translateY(-50%) rotate(-45deg);
}

.nahida-leaf-right {
  right: -6px;
  top: 50%;
  transform: translateY(-50%) rotate(135deg);
}

.nahida-gem {
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  width: 12px;
  height: 12px;
  background: var(--aiqm-leaf);
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  border: 1px solid var(--aiqm-gold);
  box-shadow: 0 0 8px var(--aiqm-leaf-soft);
  z-index: 3;
}

.nahida-capsule-bg {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: 999px;
  background-image: radial-gradient(circle at 10% 10%, rgba(111, 156, 55, 0.05), transparent 40%);
  pointer-events: none;
  overflow: hidden;
}

.nahida-capsule-bg::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: repeating-linear-gradient(45deg, rgba(200, 169, 79, 0.03) 0 1px, transparent 1px 10px);
}
`;
