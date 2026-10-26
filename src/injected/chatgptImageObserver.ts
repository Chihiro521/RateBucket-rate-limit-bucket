import { imageMessageSignal, parseImageStream } from "../platforms/chatgptImage";
import type { ImageGenerationSignal } from "../platforms/types";
import { asRecord } from "../utils/safeJson";

type Context = { startedAt: number; scope?: string; epoch: number; lastSignal?: string };
const MAX_BYTES = 2 * 1024 * 1024;

export class ChatGptImageObserver {
  private conversations = new Map<string, Context>();
  private readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  private epoch = 0;
  constructor(private emit: (signal: ImageGenerationSignal, context: Context) => void) {}

  reset(): void {
    this.epoch++;
    this.conversations.clear();
    for (const reader of this.readers) void reader.cancel().catch(() => undefined);
    this.readers.clear();
  }

  observe(rawUrl: string, input: RequestInfo | URL, init: RequestInit | undefined,
    response: Response, startedAt: number, scope?: string): void {
    const url = new URL(rawUrl, window.location.origin);
    if (url.origin !== "https://chatgpt.com") return;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    let context = this.conversations.get(url.pathname.split("/").pop()!);
    const stream = method === "POST" && url.pathname === "/backend-api/f/conversation" && response.headers.get("Content-Type")?.includes("text/event-stream");
    if (stream) {
      context = { startedAt, scope, epoch: this.epoch };
    } else if (method !== "GET" || !/^\/backend-api\/conversations\/[^/]+$/.test(url.pathname) || !response.ok || !context || (context.scope && context.scope !== scope)) return;
    context.scope ??= scope;
    void this.consume(response.clone(), context, Boolean(stream));
  }

  private remember(id: string, context: Context): void {
    if (context.epoch !== this.epoch || !/^[\da-f-]{36}$/i.test(id) || (this.conversations.get(id)?.startedAt ?? 0) > context.startedAt) return;
    this.conversations.set(id, context);
    if (this.conversations.size > 32) this.conversations.delete(this.conversations.keys().next().value!);
  }

  private async consume(response: Response, context: Context, stream: boolean): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let text = "", bytes = 0, timedOut = false, knownId = false;
    const timer = window.setTimeout(() => { timedOut = true; void reader.cancel().catch(() => undefined); }, 120_000);
    this.readers.add(reader);
    try {
      while (true) {
        const part = await reader.read();
        if (context.epoch !== this.epoch || timedOut) return;
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_BYTES) { void reader.cancel().catch(() => undefined); return; }
        text += decoder.decode(part.value, { stream: true });
        const id = stream && !knownId ? text.match(/"conversation_id"\s*:\s*"([\da-f-]{36})"/i)?.[1] : undefined;
        if (id) { this.remember(id, context); knownId = true; }
      }
      text += decoder.decode();
      const root = !stream ? asRecord(JSON.parse(text)) : null;
      const messages = Array.isArray(root?.messages) ? root.messages.map((entry) => asRecord(asRecord(entry)?.message) ?? asRecord(entry))
        .filter((message) => typeof message?.create_time === "number" && message.create_time * 1000 >= context.startedAt - 2000) : [];
      const signals = stream ? [parseImageStream(text)] : messages.map(imageMessageSignal);
      for (const signal of signals) {
        if (!signal || JSON.stringify(signal) === context.lastSignal) continue;
        context.lastSignal = JSON.stringify(signal);
        this.emit(signal, context);
      }
    } catch { /* Ignore incomplete or malformed responses. */ }
    finally { window.clearTimeout(timer); this.readers.delete(reader); reader.releaseLock(); }
  }
}
