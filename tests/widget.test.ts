// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageWidget } from "../src/content/widget";
import type { PlatformId, UsageSnapshot } from "../src/platforms/types";

let frames: FrameRequestCallback[];
let widgets: UsageWidget[];
function flush(): void { while (frames.length) for (const fn of frames.splice(0)) fn(0); }
function snapshot(platform: PlatformId, remaining = 22): UsageSnapshot {
  return { platform, source: "api", updatedAt: Date.now(), checkedAt: Date.now(), status: "ok", meters: [
    { key: "limits_progress:deep_research", label: "Deep Research", remaining, source: "api", confidence: "high", observedAt: Date.now() },
    { key: "limits_progress:image_gen", label: "Image Generation", remaining: 120, source: "api", confidence: "low", quotaState: "unknown", observedAt: Date.now() }
  ] };
}
function mount(platform: PlatformId = "chatgpt") {
  const refresh = vi.fn(), save = vi.fn();
  const widget = new UsageWidget(platform, refresh, { onLanguageModeSave: save }); widgets.push(widget);
  widget.setLanguageMode("zh-CN"); widget.mount(); widget.setSnapshot(snapshot(platform)); flush();
  const host = document.getElementById("ai-usage-floating-monitor")!;
  const root = host.shadowRoot!;
  root.querySelector<HTMLButtonElement>(".gpt-restore-chip,.collapsed")!.click(); flush();
  return { widget, root, refresh, save };
}

beforeEach(() => {
  frames = []; widgets = []; vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.push(fn); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("chrome", { runtime: { getURL: (path: string) => `/assets/${path}` } });
});
afterEach(() => { widgets.forEach((widget) => widget.destroy()); document.documentElement.querySelectorAll("#ai-usage-floating-monitor").forEach((node) => node.remove()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("existing widget experience", () => {
  it.each<PlatformId>(["chatgpt", "grok", "claude", "kimi", "gemini", "perplexity"])("keeps %s theme, mascot and language settings without IP UI", (platform) => {
    const { root } = mount(platform);
    expect(root.querySelector(".capsule-mascot")).toBeNull(); // mascot is retained in the collapsed chip, not duplicated in a panel
    expect(root.querySelector(".panel,.gpt-panel")).not.toBeNull();
    expect(root.textContent).not.toContain("IP 检测"); expect(root.textContent).not.toContain("proxycheck");
    expect(root.textContent).not.toContain("账号状态");
    expect(root.textContent).not.toContain("发送门禁");
    expect(root.textContent).not.toContain("PoW");
    root.querySelector<HTMLButtonElement>('[data-action="settings"]')!.click(); flush();
    expect(root.querySelector("select")).not.toBeNull(); expect(root.querySelector('input[type="password"]')).toBeNull();
  });
  it("reuses rows and scroll container through refresh and timer updates", () => {
    const { widget, root } = mount();
    const content = root.querySelector<HTMLElement>(".gpt-content")!, row = root.querySelector('[data-node-key="meter:limits_progress:deep_research"]');
    content.scrollTop = 123;
    widget.setLoading(true); widget.setSnapshot(snapshot("chatgpt", 21)); widget.setLoading(false); flush();
    expect(root.querySelector(".gpt-content")).toBe(content); expect(content.scrollTop).toBe(123);
    expect(root.querySelector('[data-node-key="meter:limits_progress:deep_research"]')).toBe(row);
    vi.advanceTimersByTime(1000); flush(); expect(root.querySelector(".gpt-content")).toBe(content);
    expect(root.textContent).toContain("剩余 21");
  });
  it("preserves language selection and focus across data updates and closes with Escape", () => {
    const { widget, root, save } = mount();
    const button = root.querySelector<HTMLButtonElement>('[data-action="settings"]')!;
    button.click(); flush();
    const select = root.querySelector<HTMLSelectElement>("select")!;
    select.focus(); select.value = "en"; select.dispatchEvent(new Event("change")); flush();
    widget.setSnapshot(snapshot("chatgpt", 20)); flush();
    expect(root.querySelector("select")).toBe(select); expect(select.value).toBe("en"); expect(root.activeElement).toBe(select);
    expect(save).toHaveBeenCalledWith("en");
    select.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); flush();
    expect(root.querySelector(".settings-popover")).toBeNull(); expect(root.activeElement).toBe(button);
  });
  it("does not draw invented image progress and labels stale data independently", () => {
    const { root } = mount();
    const row = root.querySelector('[data-node-key="meter:limits_progress:image_gen"]')!;
    expect(row.querySelector(".bar")).toBeNull(); expect(row.textContent).toContain("未校准");
    vi.advanceTimersByTime(121_000); flush(); expect(row.textContent).toContain("数据较旧");
  });
  it("keeps the captured drag node alive while quota responses arrive", () => {
    const { widget, root } = mount();
    root.querySelector<HTMLButtonElement>('button[title="隐藏用量面板"]')!.click(); flush();
    const chip = root.querySelector<HTMLButtonElement>(".gpt-restore-chip")!;
    chip.setPointerCapture = vi.fn(); chip.releasePointerCapture = vi.fn();
    chip.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 1, clientX: 30, clientY: 30 }));
    widget.setSnapshot(snapshot("chatgpt", 19)); flush(); expect(root.querySelector(".gpt-restore-chip")).toBe(chip);
    chip.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 80, clientY: 100 }));
    chip.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
    chip.dispatchEvent(new MouseEvent("click", { detail: 1 })); flush();
    expect(root.querySelector(".gpt-panel")).toBeNull();
  });
});
