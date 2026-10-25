import { describe, expect, it } from "vitest";
import { ChatGptImageStream, classifyImageReport, imageLimitMeter, imageSignal } from "../src/platforms/chatgptImage";
import { shouldRetainMeter } from "../src/platforms/merge";
import { formatImageRecoveryLocalized, formatMeterLabelLocalized, formatMeterValueLocalized } from "../src/utils/i18n";
import type { ImageGenerationSignal } from "../src/platforms/types";

const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const message = (text: string, extra = {}) => ({ author: { role: "assistant" }, channel: "final",
  status: "finished_successfully", content: { content_type: "text", parts: [text] }, ...extra });

describe("image generation reports", () => {
  it("recognizes the observed daily-limit report without promoting it to a server fact", () => {
    expect(classifyImageReport("图片未能生成，已达到每日图像生成上限。剩余冷却时间：19 小时 58 分钟。"))
      .toEqual({ kind: "daily_limit", evidence: "assistant", cooldownSeconds: 71_880 });
  });
  it("reads daily recovery durations in Chinese and English", () => {
    expect(classifyImageReport("You've reached your daily image limit. Please wait 2 hours before trying again."))
      .toEqual({ kind: "daily_limit", evidence: "assistant", cooldownSeconds: 7200 });
  });
  it.each(["图片生成失败，请稍后再试。", "例如，已达到每日图像额度上限时请等待 8 分钟。",
    "图像生成并发请求太多，请等待 8 分钟后再试。", "这次暂时无法生成图片，请等待 1 分钟后再试。",
    "You're generating images too quickly. Please wait 5 minutes before trying again.",
    "网络连接失败。", "图像生成没有达到每日上限。", "You have not reached your daily image limit."])("ignores unrelated failures and explanatory prose: %s", (text) => {
    expect(classifyImageReport(text)).toBeNull();
  });
  it("projects only validated fields and rejects invalid cooldowns", () => {
    expect(imageSignal({ kind: "daily_limit", evidence: "assistant", cooldownSeconds: Infinity, text: "private" }))
      .toEqual({ kind: "daily_limit", evidence: "assistant" });
    expect(imageSignal({ kind: "other", evidence: "server" })).toBeNull();
    expect(imageSignal({ kind: "daily_limit", evidence: "server" })).toBeNull();
    expect(imageSignal({ kind: "retry_later", evidence: "assistant" })).toBeNull();
  });
  it("shows provenance and keeps daily reminders until the reported reset", () => {
    const base = 1_700_000_000_000;
    const meter = { ...imageLimitMeter({ kind: "daily_limit", evidence: "assistant", cooldownSeconds: 71_880 }),
      observedAt: base, resetAt: base + 71_880_000 };
    expect(formatMeterValueLocalized("zh-CN", meter)).toBe("已达到上限");
    expect(formatMeterLabelLocalized("zh-CN", meter)).toBe("图像生成");
    expect(shouldRetainMeter(meter, base + 3_600_000)).toBe(true);
    expect(shouldRetainMeter(meter, base + 71_880_000)).toBe(false);
  });
  it("shows a local estimated recovery time and keeps missing recovery times unknown", () => {
    const meter = { ...imageLimitMeter({ kind: "daily_limit", evidence: "assistant" }),
      resetAt: new Date(2026, 9, 25, 13, 8).getTime() };
    expect(formatImageRecoveryLocalized("zh-CN", meter)).toBe("预计恢复 10-25 13:08");
    expect(formatImageRecoveryLocalized("en", meter)).toBe("Estimated recovery 10-25 13:08");
    expect(formatImageRecoveryLocalized("zh-CN", { ...meter, resetAt: undefined })).toBe("恢复时间未知");
  });
  it("does not label an uncalibrated value as an image balance", () => {
    expect(formatMeterValueLocalized("zh-CN", { key: "limits_progress:image_gen", label: "Image Generation", remaining: 120,
      quotaState: "unknown", source: "api", confidence: "low" })).toBe("未校准读数 120");
  });
});

describe("image SSE projection", () => {
  it("handles split UTF-8 strings, CRLF boundaries, inherited delta paths and nested patches", () => {
    const signals: ImageGenerationSignal[] = [];
    const parser = new ChatGptImageStream((signal) => signals.push(signal));
    const stream = frame({ p: "", o: "add", v: { message: message("", { status: "in_progress" }) } }) +
      frame({ p: "/message/content/parts/0", o: "append", v: "图片未能生成，已达到每日图像生成" }) +
      frame({ v: "上限。剩余冷却时间：19 小时 58 分钟。" }) +
      frame({ p: "", o: "patch", v: [{ p: "/message/status", o: "replace", v: "finished_successfully" }] }) + "data: [DONE]\n\n";
    const bytes = new TextEncoder().encode(stream.replace(/\n/g, "\r\n"));
    const decoder = new TextDecoder();
    for (const byte of bytes) parser.push(decoder.decode(new Uint8Array([byte]), { stream: true }));
    parser.push(decoder.decode()); parser.finish();
    expect(signals).toEqual([{ kind: "daily_limit", evidence: "assistant", cooldownSeconds: 71_880 }]);
  });
  it("ignores user prompts, hidden content, unfinished text and quota metadata with positive remaining", () => {
    const signals: ImageGenerationSignal[] = [];
    const parser = new ChatGptImageStream((signal) => signals.push(signal));
    for (const extra of [{ author: { role: "user" } }, { channel: "analysis" }, { content: { content_type: "reasoning_recap", parts: ["已达到每日图像上限"] } }, { status: "in_progress" }]) {
      parser.push(frame({ message: message("已达到每日图像上限", extra) }));
    }
    parser.push(frame({ type: "conversation_detail_metadata", limits_progress: [{ feature_name: "image_gen", remaining: 120 }], blocked_features: [] }));
    parser.finish(); expect(signals).toEqual([]);
  });
  it("recognizes an actual tool image and clears its transient projection", () => {
    const signals: ImageGenerationSignal[] = [];
    const parser = new ChatGptImageStream((signal) => signals.push(signal));
    parser.push(frame({ message: { author: { role: "tool" }, status: "finished_successfully", content: {
      content_type: "multimodal_text", parts: [{ content_type: "image_asset_pointer", asset_pointer: "private-asset" }]
    } } }));
    parser.finish(); expect(signals).toEqual([{ kind: "success", evidence: "server" }]);
    expect(JSON.stringify(parser)).not.toContain("private-asset");
  });
  it("bounds malformed frames without emitting a guessed limit", () => {
    const signals: ImageGenerationSignal[] = [];
    const parser = new ChatGptImageStream((signal) => signals.push(signal));
    parser.push("x".repeat(300_000)); parser.push(frame({ message: message("已达到每日图像上限") }));
    parser.finish(); expect(signals).toEqual([]);
  });
});
