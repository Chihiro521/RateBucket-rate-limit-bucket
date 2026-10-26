import type { ImageGenerationSignal, UsageMeter } from "./types";
import { asRecord } from "../utils/safeJson";

export const IMAGE_GENERATION_KEY = "limits_progress:image_gen";
const MAX_TEXT = 16_384;

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

export function imageMessageSignal(value: unknown): ImageGenerationSignal | null {
  const message = asRecord(value), content = asRecord(message?.content);
  if (message?.status !== "finished_successfully" || !content) return null;
  const role = asRecord(message.author)?.role;
  const parts = Array.isArray(content.parts) ? content.parts : [];
  if (role === "tool" && parts.some((part) => asRecord(part)?.content_type === "image_asset_pointer")) return { kind: "success", evidence: "server" };
  if (role !== "assistant" || message.channel !== "final" || content.content_type !== "text") return null;
  return classifyImageReport(typeof content.text === "string" ? content.text : parts.filter((part) => typeof part === "string").join(""));
}

// Responses are bounded by the reader; only a derived result leaves page memory.
export function parseImageStream(text: string): ImageGenerationSignal | null {
  let message: Record<string, unknown> | null = null, result: ImageGenerationSignal | null = null;
  let path = "", operation = "";
  const visit = (record: Record<string, unknown>): void => {
    if (record.type === "input_message") return;
    const root = asRecord(record.v);
    if (record.message) message = asRecord(record.message);
    if ("v" in record) {
      path = typeof record.p === "string" ? record.p : path;
      operation = typeof record.o === "string" ? record.o : operation;
      if (operation === "patch" && Array.isArray(record.v)) {
        const parentPath = path, parentOperation = operation;
        for (const entry of record.v) { const child = asRecord(entry); if (child) visit(child); }
        path = parentPath; operation = parentOperation;
      } else if (path === "" && root?.message) message = asRecord(root.message);
      else if (path === "/message") message = root;
      else if (message) {
        const content = asRecord(message.content), index = path.match(/^\/message\/content\/parts\/(\d+)$/)?.[1];
        if (path === "/message/status") message.status = record.v;
        else if (path === "/message/content") message.content = record.v;
        else if (content && index !== undefined && Array.isArray(content.parts) && Number(index) <= content.parts.length) {
          content.parts[Number(index)] = operation === "append" && typeof record.v === "string"
            ? String(content.parts[Number(index)] ?? "") + record.v : record.v;
        } else if (content && path === "/message/content/text") {
          content.text = operation === "append" ? String(content.text ?? "") + String(record.v) : record.v;
        } else if (content && path === "/message/content/parts") {
          const parts = Array.isArray(record.v) ? record.v : [record.v];
          content.parts = operation === "append" && Array.isArray(content.parts) ? [...content.parts, ...parts] : parts;
        }
      }
    }
    result = imageMessageSignal(message) ?? result;
  };
  for (const frame of text.split(/\r?\n\r?\n/)) {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    try { const record = asRecord(JSON.parse(data)); if (record) visit(record); } catch { /* Includes [DONE]. */ }
  }
  return result;
}
