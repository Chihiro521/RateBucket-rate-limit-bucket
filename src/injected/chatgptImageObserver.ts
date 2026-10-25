import { ChatGptImageStream } from "../platforms/chatgptImage";
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
    let url: URL;
    try { url = new URL(rawUrl, window.location.origin); } catch { return; }
    if (url.origin !== "https://chatgpt.com") return;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method === "POST" && url.pathname === "/backend-api/f/conversation") {
      const context: Context = { startedAt, scope, epoch: this.epoch };
      if (typeof init?.body === "string" && init.body.length < MAX_BYTES) {
        try {
          const body = asRecord(JSON.parse(init.body));
          if (typeof body?.conversation_id === "string") this.remember(body.conversation_id, context);
        } catch { /* No request contents are retained. */ }
      }
      if (response.headers.get("Content-Type")?.includes("text/event-stream")) {
        const parser = this.parser(context);
        void this.read(response.clone(), (text) => parser.push(text))
          .then((complete) => complete ? parser.finish() : parser.dispose());
      }
      return;
    }
    const id = url.pathname.match(/^\/backend-api\/conversations\/([^/]+)$/)?.[1];
    const context = id && this.conversations.get(id);
    if (method !== "GET" || !response.ok || !context || (context.scope && context.scope !== scope)) return;
    if (!context.scope && scope) context.scope = scope;
    void this.readConversation(response.clone(), context);
  }

  private parser(context: Context): ChatGptImageStream {
    return new ChatGptImageStream((signal) => this.report(signal, context), (id) => this.remember(id, context));
  }

  private async readConversation(response: Response, context: Context): Promise<void> {
    let text = "";
    if (!await this.read(response, (chunk) => { text += chunk; })) return;
    const parser = this.parser(context);
    try {
      const root = asRecord(JSON.parse(text));
      for (const entry of Array.isArray(root?.messages) ? root.messages : []) {
        const wrapper = asRecord(entry), message = asRecord(wrapper?.message) ?? wrapper;
        if (typeof message?.create_time === "number" && message.create_time * 1000 >= context.startedAt - 2000) parser.acceptMessage(message);
      }
    } catch { /* Ignore non-JSON responses. */ }
    finally { parser.dispose(); }
  }

  private remember(id: string, context: Context): void {
    if (context.epoch !== this.epoch || !/^[\da-f-]{36}$/i.test(id)) return;
    if ((this.conversations.get(id)?.startedAt ?? 0) > context.startedAt) return;
    this.conversations.set(id, context);
    if (this.conversations.size > 32) this.conversations.delete(this.conversations.keys().next().value!);
  }

  private report(signal: ImageGenerationSignal, context: Context): void {
    if (context.epoch !== this.epoch) return;
    const key = JSON.stringify(signal);
    if (context.lastSignal === key) return;
    context.lastSignal = key;
    this.emit(signal, context);
  }

  private async read(response: Response, chunk: (text: string) => void): Promise<boolean> {
    const reader = response.body?.getReader();
    if (!reader) return false;
    const epoch = this.epoch, decoder = new TextDecoder();
    this.readers.add(reader);
    let bytes = 0, timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; void reader.cancel().catch(() => undefined); }, 120_000);
    try {
      while (true) {
        const result = await reader.read();
        if (epoch !== this.epoch || timedOut) return false;
        if (result.done) { chunk(decoder.decode()); return true; }
        bytes += result.value.byteLength;
        if (bytes > MAX_BYTES) { void reader.cancel().catch(() => undefined); return false; }
        chunk(decoder.decode(result.value, { stream: true }));
      }
    } catch { return false; }
    finally { window.clearTimeout(timer); this.readers.delete(reader); reader.releaseLock(); }
  }
}
