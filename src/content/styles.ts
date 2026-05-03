export const WIDGET_CSS = `
:host {
  color-scheme: light;
  position: fixed;
  z-index: 2147483000;
  font-family: "Microsoft YaHei", Inter, ui-sans-serif, system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  --aiqm-paper: #fffdf3;
  --aiqm-paper-soft: #f8f3dc;
  --aiqm-ink: #31461f;
  --aiqm-muted: #7b7a64;
  --aiqm-leaf: #6f9c37;
  --aiqm-leaf-dark: #3c661d;
  --aiqm-leaf-soft: #dbeaba;
  --aiqm-gold: #c8a94f;
  --aiqm-gold-soft: #efe2a7;
  --aiqm-line: rgba(139, 157, 79, 0.3);
  color: var(--aiqm-ink);
}

:host([data-platform="chatgpt"]) {
  top: 24px;
  right: 24px;
}

:host(:not([data-platform="chatgpt"])) {
  top: 50%;
  right: 12px;
  transform: translateY(-50%);
}

* { box-sizing: border-box; }
button { font: inherit; cursor: pointer; border: none; background: none; padding: 0; }

/* Capsule / Collapsed */
.nahida-capsule, .collapsed, .gpt-restore-chip {
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
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  user-select: none;
  border-bottom-width: 2px;
}

.nahida-capsule:hover, .collapsed:hover, .gpt-restore-chip:hover {
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
  border: 2px solid var(--aiqm-gold-soft);
  background: white;
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
  letter-spacing: 1px;
}

.nahida-value {
  font-size: 17px;
  font-weight: 800;
  color: var(--aiqm-ink);
}

/* Main Panel */
.panel, .gpt-panel {
  width: 380px;
  background: var(--aiqm-paper);
  border: 1px solid var(--aiqm-gold);
  border-radius: 16px;
  box-shadow: 0 20px 50px rgba(56, 71, 36, 0.25);
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
}

.panel::before, .gpt-panel::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background-image: radial-gradient(circle at 100% 0%, rgba(111, 156, 55, 0.08), transparent 40%);
  pointer-events: none;
}

/* Header */
.header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--aiqm-line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  background: linear-gradient(to bottom, #fffdf8, #f8f6e8);
}

.header-decoration-chibi {
  position: absolute;
  top: -12px;
  right: 60px;
  width: 64px;
  height: 64px;
  z-index: 10;
  pointer-events: none;
}

.title, .gpt-title {
  font-size: 24px;
  font-weight: 900;
  font-family: Georgia, serif;
  color: var(--aiqm-ink);
  display: flex;
  align-items: center;
}

.title::before, .gpt-title::before {
  content: "✥";
  margin-right: 8px;
  color: var(--aiqm-leaf);
}

.actions {
  display: flex;
  gap: 8px;
  z-index: 11;
}

.icon-button {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--aiqm-gold);
  background: white;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  color: var(--aiqm-ink);
  font-weight: bold;
}

.icon-button:hover {
  background: var(--aiqm-paper-soft);
  transform: scale(1.1);
}

/* Meta Info */
.meta {
  padding: 8px 20px;
  font-size: 12px;
  color: var(--aiqm-muted);
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid var(--aiqm-line);
}

/* Content Area */
.content, .gpt-content {
  padding: 12px 20px 40px;
  overflow-y: auto;
  max-height: 500px;
  background: linear-gradient(to bottom, #fffdf3, #fffbf0);
}

.meter-section {
  margin-top: 16px;
  border: 1px solid rgba(151, 132, 62, 0.2);
  border-radius: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.5);
}

.meter-section-title {
  font-size: 14px;
  font-weight: 800;
  color: var(--aiqm-leaf-dark);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
}

.meter-section-title::before {
  content: "☘";
  margin-right: 6px;
}

/* Progress Bar */
.bar {
  height: 10px;
  background: rgba(111, 156, 55, 0.1);
  border: 1px solid rgba(111, 156, 55, 0.2);
  border-radius: 5px;
  margin: 10px 0;
  position: relative;
  overflow: visible;
}

.bar-fill {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, #8cbf49, #6f9c37);
  position: relative;
}

.bar-fill::after {
  content: "";
  position: absolute;
  top: 50%;
  right: -6px;
  width: 14px;
  height: 14px;
  background: var(--aiqm-leaf);
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M17,8C8,10 5,16 5,16C5,16 11,13 20,15C20,15 18,11 17,8Z' /%3E%3C/svg%3E");
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M17,8C8,10 5,16 5,16C5,16 11,13 20,15C20,15 18,11 17,8Z' /%3E%3C/svg%3E");
  transform: translateY(-50%) rotate(20deg);
}

/* Footer Decoration */
.panel-footer-decoration {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 40px;
  background: linear-gradient(to top, #f0ede0, transparent);
  display: flex;
  justify-content: center;
  align-items: center;
  pointer-events: none;
}

.footer-gem {
  width: 18px;
  height: 18px;
  background: var(--aiqm-leaf);
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  border: 1px solid var(--aiqm-gold);
  box-shadow: 0 0 10px var(--aiqm-leaf);
}

/* Status Dot */
.status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; }
.status-ok { background: #10b981; }
.status-partial { background: #f59e0b; }
.status-error { background: #ef4444; }

/* Scrollbar */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-thumb { background: var(--aiqm-leaf-soft); border-radius: 3px; }

/* Additional Styles */
.meter-top { display: flex; justify-content: space-between; font-weight: 700; }
.meter-bottom { display: flex; justify-content: space-between; font-size: 11px; color: var(--aiqm-muted); margin-top: 4px; }
.badge { background: var(--aiqm-paper-soft); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--aiqm-line); }

.sentinel-block { margin-top: 8px; }
.sentinel-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
.sentinel-label { color: var(--aiqm-muted); }
.sentinel-explanation { font-size: 11px; opacity: 0.8; margin-top: 4px; }

.settings-popover {
  position: fixed;
  top: 60px;
  right: 24px;
  width: 320px;
  background: var(--aiqm-paper);
  border: 1px solid var(--aiqm-gold);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.1);
  z-index: 2147483002;
}

.settings-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.settings-title { font-weight: 800; font-size: 16px; }
.settings-input { width: 100%; padding: 8px; border: 1px solid var(--aiqm-gold); border-radius: 6px; background: white; margin-top: 8px; }
.settings-actions { display: flex; gap: 8px; margin-top: 16px; }
.settings-button { flex: 1; padding: 8px; border-radius: 6px; border: 1px solid var(--aiqm-gold); text-align: center; }
.primary-button { background: var(--aiqm-leaf); color: white; border: none; }
`;
