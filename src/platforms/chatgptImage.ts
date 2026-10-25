import type { ImageGenerationSignal, UsageMeter } from "./types";
import { asRecord } from "../utils/safeJson";

export const IMAGE_GENERATION_KEY = "limits_progress:image_gen";
const MAX_TEXT = 16_384;
const MAX_FRAME = 262_144;

export function imageSignal(value: unknown): ImageGenerationSignal | null {
  const record = asRecord(value);
  if (!record) return null;
  if (record.kind === "success" && record.evidence === "server") return { kind: "success", evidence: "server" };
  if (record.kind !== "daily_limit" || record.evidence !== "assistant") return null;
  const seconds = record.cooldownSeconds;
  return { kind: "daily_limit", evidence: "assistant",
    ...(typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 && seconds <= 86_400
      ? { cooldownSeconds: Math.ceil(seconds) } : {}) };
}

export function imageLimitMeter(signal: Extract<ImageGenerationSignal, { kind: "daily_limit" }>): UsageMeter {
  return { key: IMAGE_GENERATION_KEY, label: "Image Generation", imageLimit: true,
    quotaState: "blocked", source: "intercepted", confidence: "low", metricKind: "quota", unit: "count",
    resetAfterSeconds: signal.cooldownSeconds, rawKind: "limits_progress" };
}

export function clearImageLimit(meter: UsageMeter, observedAt: number): UsageMeter {
  return { key: IMAGE_GENERATION_KEY, label: "Image Generation", remaining: null,
    quotaState: "unknown", source: "unknown", confidence: "low", metricKind: "quota", unit: "count",
    observedAt, requestStartedAt: meter.requestStartedAt, rawKind: "limits_progress" };
}

// These are reports from assistant text, not an independent quota reading.
export function classifyImageReport(text: string): ImageGenerationSignal | null {
  const value = text.slice(0, MAX_TEXT).replace(/[*_`]/g, "");
  if (!/(?:图像|图片|生图|image)/i.test(value) ||
      /(?:例如|举例|假如|如果|假设|示例|for example|hypothetical|if you)/i.test(value) ||
      /(?:没有|尚未|并未|未).{0,4}达到|(?:not|haven't|hasn't).{0,10}(?:reached|exceeded|hit)/i.test(value)) return null;
  const daily = /(?:已达(?:到)?|用完|耗尽|撞[上到]|达到).{0,30}(?:每日|每天|今日|今天).{0,30}(?:额度|上限|限额)|(?:每日|每天|今日|今天).{0,30}(?:额度|上限|限额).{0,12}(?:用完|耗尽|已达)|(?:reached|exceeded|hit).{0,40}daily.{0,30}(?:limit|quota)|daily.{0,30}(?:limit|quota).{0,20}(?:reached|exceeded|exhausted)/i.test(value);
  if (!daily) return null;
  return { kind: "daily_limit", evidence: "assistant", cooldownSeconds: reportCooldown(value) };
}

function reportCooldown(text: string): number | undefined {
  const context = text.match(/(?:等待|请等|稍等|冷却|重置时间|恢复|请.{0,8}后|wait|try again|retry|reset).{0,100}/i)?.[0] ??
    text.match(/[^。.!?\n]{0,70}(?:后再试|后重试|再次尝试)/)?.[0];
  if (!context) return undefined;
  let seconds = 0;
  for (const match of context.matchAll(/(\d+(?:\.\d+)?)\s*(小时|分钟|秒|hours?|hrs?|minutes?|mins?|seconds?|secs?)/gi)) {
    const unit = match[2].toLowerCase();
    seconds += Number(match[1]) * (/小时|hour|hr/.test(unit) ? 3600 : /分钟|min/.test(unit) ? 60 : 1);
  }
  return seconds > 0 && seconds <= 86_400 ? Math.ceil(seconds) : undefined;
}

type Projection = { role?: string; channel?: string; type?: string; status?: string; text: string; image: boolean };

// Only a bounded projection of the current message is retained in page memory.
// User/system messages, reasoning, image URLs, IDs and raw frames are never emitted.
export class ChatGptImageStream {
  private buffer = "";
  private path = "";
  private operation = "";
  private message: Projection = { text: "", image: false };
  private stopped = false;

  constructor(private emit: (signal: ImageGenerationSignal) => void, private conversation?: (id: string) => void) {}

  push(chunk: string): void {
    if (this.stopped) return;
    this.buffer = (this.buffer + chunk).replace(/\r\n/g, "\n");
    let end: number;
    while ((end = this.buffer.indexOf("\n\n")) >= 0) {
      const frame = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      if (frame.length <= MAX_FRAME) this.frame(frame);
    }
    if (this.buffer.length > MAX_FRAME) this.dispose();
  }

  finish(): void { this.flush(); this.dispose(); }

  dispose(): void {
    this.stopped = true;
    this.buffer = "";
    this.message = { text: "", image: false };
  }

  private frame(frame: string): void {
    const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (data === "[DONE]") { this.flush(); return; }
    let value: unknown;
    try { value = JSON.parse(data); } catch { return; }
    const record = asRecord(value);
    if (!record) return;
    if (record.type === "input_message") return;
    if (typeof record.conversation_id === "string") this.conversation?.(record.conversation_id);
    if (record.message) this.acceptMessage(record.message);
    else if ("v" in record) this.patch(record);
    if (record.type === "message_stream_complete") this.flush();
  }

  acceptMessage(value: unknown): void {
    const record = asRecord(value);
    if (!record) return;
    this.flush();
    const author = asRecord(record.author), content = asRecord(record.content);
    this.message = { role: typeof author?.role === "string" ? author.role : undefined,
      channel: typeof record.channel === "string" ? record.channel : undefined,
      status: typeof record.status === "string" ? record.status : undefined, text: "", image: false };
    this.content(content);
    if (this.message.status === "finished_successfully") this.flush();
  }

  private content(value: unknown): void {
    const record = asRecord(value);
    if (record) {
      this.message.type = typeof record.content_type === "string" ? record.content_type : undefined;
      this.parts(typeof record.text === "string" ? record.text : record.parts);
    }
  }

  private parts(value: unknown, append = false): void {
    const parts = Array.isArray(value) ? value : [value];
    if (this.message.role === "tool" && parts.some((part) => asRecord(part)?.content_type === "image_asset_pointer")) this.message.image = true;
    if (this.message.role !== "assistant" || this.message.channel !== "final" || this.message.type !== "text") return;
    const text = parts.filter((part): part is string => typeof part === "string").join("");
    this.message.text = (append ? this.message.text + text : text).slice(0, MAX_TEXT);
  }

  private patch(record: Record<string, unknown>): void {
    const path = typeof record.p === "string" ? record.p : this.path;
    const operation = typeof record.o === "string" ? record.o : this.operation;
    this.path = path; this.operation = operation;
    if (operation === "patch" && Array.isArray(record.v)) {
      for (const entry of record.v) { const child = asRecord(entry); if (child) this.patch(child); }
      this.path = path; this.operation = operation;
      return;
    }
    const value = record.v;
    if (path === "" && asRecord(value)) {
      const root = asRecord(value)!;
      if (typeof root.conversation_id === "string") this.conversation?.(root.conversation_id);
      if (root.message) this.acceptMessage(root.message);
    } else if (path === "/message") this.acceptMessage(value);
    else if (path === "/message/author/role" && typeof value === "string") this.message.role = value;
    else if (path === "/message/channel" && typeof value === "string") this.message.channel = value;
    else if (path === "/message/content") this.content(value);
    else if (path === "/message/content/content_type" && typeof value === "string") this.message.type = value;
    else if (path === "/message/content/parts" || /^\/message\/content\/(?:parts\/\d+|text)$/.test(path)) this.parts(value, operation === "append");
    else if (/^\/message\/content\/parts\/\d+\/content_type$/.test(path) && value === "image_asset_pointer" && this.message.role === "tool") this.message.image = true;
    else if (path === "/message/status" && typeof value === "string") {
      this.message.status = value;
      if (value === "finished_successfully") this.flush();
    }
  }

  private flush(): void {
    if (this.message.status !== "finished_successfully") return;
    this.message.status = undefined;
    const signal = this.message.image ? { kind: "success", evidence: "server" } as const
      : classifyImageReport(this.message.text);
    if (!signal) return;
    this.emit(signal);
  }
}
