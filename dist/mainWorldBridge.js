(function() {
  "use strict";
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function asRecord(value) {
    return isRecord(value) ? value : null;
  }
  function asString(value) {
    return typeof value === "string" ? value : null;
  }
  function asNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
  function getRecord(record, key) {
    return asRecord(record[key]);
  }
  function getNumber(record, key) {
    return asNumber(record[key]);
  }
  function getString(record, key) {
    return asString(record[key]);
  }
  class ChatGptSession {
    constructor(fetcher, changed, now = Date.now) {
      this.fetcher = fetcher;
      this.changed = changed;
      this.now = now;
    }
    cached;
    flight;
    account;
    accountKnown = false;
    user;
    epoch = 0;
    observeAccount(value) {
      if (value === null) return;
      const account = value.trim() || void 0;
      if (this.accountKnown && account === this.account) return;
      this.account = account;
      this.accountKnown = true;
      this.invalidate();
      this.changed();
    }
    invalidate() {
      this.epoch++;
      this.cached = void 0;
      this.flight = void 0;
    }
    async observeSession(json) {
      const root = asRecord(json);
      const user = root ? getRecord(root, "user") : null;
      const id = user ? getString(user, "id") ?? void 0 : void 0;
      if (id && this.user && id !== this.user) {
        this.user = id;
        this.account = void 0;
        this.accountKnown = false;
        this.invalidate();
        this.changed();
      }
    }
    scope() {
      return this.cached?.scopeKey;
    }
    read() {
      if (this.cached && this.cached.expires > this.now()) return Promise.resolve(this.cached);
      if (this.flight) return this.flight;
      const epoch = this.epoch;
      const account = this.account;
      const accountKnown = this.accountKnown;
      const flight = (async () => {
        const response = await this.fetcher("https://chatgpt.com/api/auth/session", { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(1e4) });
        const root = response.ok ? asRecord(await response.json()) : null;
        const token = root ? getString(root, "accessToken") ?? getString(root, "access_token") : null;
        if (!token) throw new Error("ChatGPT session unavailable");
        const userRecord = root ? getRecord(root, "user") : null;
        const user = userRecord ? getString(userRecord, "id") ?? void 0 : void 0;
        if (epoch !== this.epoch) throw new Error("Account context changed");
        if (user && this.user && user !== this.user) {
          this.user = user;
          this.account = void 0;
          this.accountKnown = false;
          this.invalidate();
          this.changed();
          throw new Error("Account context changed");
        }
        this.user = user;
        const scopeKey = user && accountKnown ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${user}|${account ?? "personal"}`)))).map((byte) => byte.toString(16).padStart(2, "0")).join("") : void 0;
        if (epoch !== this.epoch) throw new Error("Account context changed");
        const result = { token, user, account, scopeKey, expires: this.now() + 6e4 };
        this.cached = result;
        return result;
      })();
      this.flight = flight;
      void flight.finally(() => {
        if (this.flight === flight) this.flight = void 0;
      }).catch(() => void 0);
      return flight;
    }
  }
  const MAX_TEXT = 16384;
  const MAX_FRAME = 262144;
  function classifyImageReport(text) {
    const value = text.slice(0, MAX_TEXT).replace(/[*_`]/g, "");
    if (!/(?:图像|图片|生图|image)/i.test(value) || /(?:例如|举例|假如|如果|假设|示例|for example|hypothetical|if you)/i.test(value) || /(?:没有|尚未|并未|未).{0,4}达到|(?:not|haven't|hasn't).{0,10}(?:reached|exceeded|hit)/i.test(value)) return null;
    const daily = /(?:已达(?:到)?|用完|耗尽|撞[上到]|达到).{0,30}(?:每日|每天|今日|今天).{0,30}(?:额度|上限|限额)|(?:每日|每天|今日|今天).{0,30}(?:额度|上限|限额).{0,12}(?:用完|耗尽|已达)|(?:reached|exceeded|hit).{0,40}daily.{0,30}(?:limit|quota)|daily.{0,30}(?:limit|quota).{0,20}(?:reached|exceeded|exhausted)/i.test(value);
    if (!daily) return null;
    return { kind: "daily_limit", evidence: "assistant", cooldownSeconds: reportCooldown(value) };
  }
  function reportCooldown(text) {
    const context = text.match(/(?:等待|请等|稍等|冷却|重置时间|恢复|请.{0,8}后|wait|try again|retry|reset).{0,100}/i)?.[0] ?? text.match(/[^。.!?\n]{0,70}(?:后再试|后重试|再次尝试)/)?.[0];
    if (!context) return void 0;
    let seconds = 0;
    for (const match of context.matchAll(/(\d+(?:\.\d+)?)\s*(小时|分钟|秒|hours?|hrs?|minutes?|mins?|seconds?|secs?)/gi)) {
      const unit = match[2].toLowerCase();
      seconds += Number(match[1]) * (/小时|hour|hr/.test(unit) ? 3600 : /分钟|min/.test(unit) ? 60 : 1);
    }
    return seconds > 0 && seconds <= 86400 ? Math.ceil(seconds) : void 0;
  }
  class ChatGptImageStream {
    constructor(emit, conversation) {
      this.emit = emit;
      this.conversation = conversation;
    }
    buffer = "";
    path = "";
    operation = "";
    message = { text: "", image: false };
    stopped = false;
    push(chunk) {
      if (this.stopped) return;
      this.buffer = (this.buffer + chunk).replace(/\r\n/g, "\n");
      let end;
      while ((end = this.buffer.indexOf("\n\n")) >= 0) {
        const frame = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 2);
        if (frame.length <= MAX_FRAME) this.frame(frame);
      }
      if (this.buffer.length > MAX_FRAME) this.dispose();
    }
    finish() {
      this.flush();
      this.dispose();
    }
    dispose() {
      this.stopped = true;
      this.buffer = "";
      this.message = { text: "", image: false };
    }
    frame(frame) {
      const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (data === "[DONE]") {
        this.flush();
        return;
      }
      let value;
      try {
        value = JSON.parse(data);
      } catch {
        return;
      }
      const record = asRecord(value);
      if (!record) return;
      if (record.type === "input_message") return;
      if (typeof record.conversation_id === "string") this.conversation?.(record.conversation_id);
      if (record.message) this.acceptMessage(record.message);
      else if ("v" in record) this.patch(record);
      if (record.type === "message_stream_complete") this.flush();
    }
    acceptMessage(value) {
      const record = asRecord(value);
      if (!record) return;
      this.flush();
      const author = asRecord(record.author), content = asRecord(record.content);
      this.message = {
        role: typeof author?.role === "string" ? author.role : void 0,
        channel: typeof record.channel === "string" ? record.channel : void 0,
        status: typeof record.status === "string" ? record.status : void 0,
        text: "",
        image: false
      };
      this.content(content);
      if (this.message.status === "finished_successfully") this.flush();
    }
    content(value) {
      const record = asRecord(value);
      if (record) {
        this.message.type = typeof record.content_type === "string" ? record.content_type : void 0;
        this.parts(typeof record.text === "string" ? record.text : record.parts);
      }
    }
    parts(value, append = false) {
      const parts = Array.isArray(value) ? value : [value];
      if (this.message.role === "tool" && parts.some((part) => asRecord(part)?.content_type === "image_asset_pointer")) this.message.image = true;
      if (this.message.role !== "assistant" || this.message.channel !== "final" || this.message.type !== "text") return;
      const text = parts.filter((part) => typeof part === "string").join("");
      this.message.text = (append ? this.message.text + text : text).slice(0, MAX_TEXT);
    }
    patch(record) {
      const path = typeof record.p === "string" ? record.p : this.path;
      const operation = typeof record.o === "string" ? record.o : this.operation;
      this.path = path;
      this.operation = operation;
      if (operation === "patch" && Array.isArray(record.v)) {
        for (const entry of record.v) {
          const child = asRecord(entry);
          if (child) this.patch(child);
        }
        this.path = path;
        this.operation = operation;
        return;
      }
      const value = record.v;
      if (path === "" && asRecord(value)) {
        const root = asRecord(value);
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
    flush() {
      if (this.message.status !== "finished_successfully") return;
      this.message.status = void 0;
      const signal = this.message.image ? { kind: "success", evidence: "server" } : classifyImageReport(this.message.text);
      if (!signal) return;
      this.emit(signal);
    }
  }
  const MAX_BYTES = 2 * 1024 * 1024;
  class ChatGptImageObserver {
    constructor(emit) {
      this.emit = emit;
    }
    conversations = /* @__PURE__ */ new Map();
    readers = /* @__PURE__ */ new Set();
    epoch = 0;
    reset() {
      this.epoch++;
      this.conversations.clear();
      for (const reader of this.readers) void reader.cancel().catch(() => void 0);
      this.readers.clear();
    }
    observe(rawUrl, input, init, response, startedAt, scope) {
      let url;
      try {
        url = new URL(rawUrl, window.location.origin);
      } catch {
        return;
      }
      if (url.origin !== "https://chatgpt.com") return;
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (method === "POST" && url.pathname === "/backend-api/f/conversation") {
        const context2 = { startedAt, scope, epoch: this.epoch };
        if (typeof init?.body === "string" && init.body.length < MAX_BYTES) {
          try {
            const body = asRecord(JSON.parse(init.body));
            if (typeof body?.conversation_id === "string") this.remember(body.conversation_id, context2);
          } catch {
          }
        }
        if (response.headers.get("Content-Type")?.includes("text/event-stream")) {
          const parser = this.parser(context2);
          void this.read(response.clone(), (text) => parser.push(text)).then((complete) => complete ? parser.finish() : parser.dispose());
        }
        return;
      }
      const id = url.pathname.match(/^\/backend-api\/conversations\/([^/]+)$/)?.[1];
      const context = id && this.conversations.get(id);
      if (method !== "GET" || !response.ok || !context || context.scope && context.scope !== scope) return;
      if (!context.scope && scope) context.scope = scope;
      void this.readConversation(response.clone(), context);
    }
    parser(context) {
      return new ChatGptImageStream((signal) => this.report(signal, context), (id) => this.remember(id, context));
    }
    async readConversation(response, context) {
      let text = "";
      if (!await this.read(response, (chunk) => {
        text += chunk;
      })) return;
      const parser = this.parser(context);
      try {
        const root = asRecord(JSON.parse(text));
        for (const entry of Array.isArray(root?.messages) ? root.messages : []) {
          const wrapper = asRecord(entry), message = asRecord(wrapper?.message) ?? wrapper;
          if (typeof message?.create_time === "number" && message.create_time * 1e3 >= context.startedAt - 2e3) parser.acceptMessage(message);
        }
      } catch {
      } finally {
        parser.dispose();
      }
    }
    remember(id, context) {
      if (context.epoch !== this.epoch || !/^[\da-f-]{36}$/i.test(id)) return;
      if ((this.conversations.get(id)?.startedAt ?? 0) > context.startedAt) return;
      this.conversations.set(id, context);
      if (this.conversations.size > 32) this.conversations.delete(this.conversations.keys().next().value);
    }
    report(signal, context) {
      if (context.epoch !== this.epoch) return;
      const key = JSON.stringify(signal);
      if (context.lastSignal === key) return;
      context.lastSignal = key;
      this.emit(signal, context);
    }
    async read(response, chunk) {
      const reader = response.body?.getReader();
      if (!reader) return false;
      const epoch = this.epoch, decoder = new TextDecoder();
      this.readers.add(reader);
      let bytes = 0, timedOut = false;
      const timer = window.setTimeout(() => {
        timedOut = true;
        void reader.cancel().catch(() => void 0);
      }, 12e4);
      try {
        while (true) {
          const result = await reader.read();
          if (epoch !== this.epoch || timedOut) return false;
          if (result.done) {
            chunk(decoder.decode());
            return true;
          }
          bytes += result.value.byteLength;
          if (bytes > MAX_BYTES) {
            void reader.cancel().catch(() => void 0);
            return false;
          }
          chunk(decoder.decode(result.value, { stream: true }));
        }
      } catch {
        return false;
      } finally {
        window.clearTimeout(timer);
        this.readers.delete(reader);
        reader.releaseLock();
      }
    }
  }
  const MUSE_ENDPOINT_KEY = "muse:subscription";
  function parseMuseSubscriptionJson(value) {
    const root = asRecord(value);
    if (!root || typeof root.success !== "boolean") return null;
    if (!root.success) {
      const recovery = asRecord(root.sessionRecovery);
      const unauthorized = root.unauthorized === true || recovery?.scope === "hatch" && (recovery.reason === "authentication" || recovery.reason === "checkpoint");
      return {
        success: false,
        unauthorized,
        error: unauthorized ? "请登录 Muse 后刷新额度" : "Muse 额度查询失败"
      };
    }
    const subscription = asRecord(root.subscription);
    if (!subscription) return null;
    const tier = asRecord(subscription.tier);
    const usage = asRecord(subscription.usage);
    return {
      success: true,
      subscription: {
        tier: tier ? {
          name: getString(tier, "name") ?? void 0,
          tierId: getString(tier, "tierId") ?? void 0
        } : void 0,
        usage: usage ? {
          state: getString(usage, "state") ?? void 0,
          percentUsed: getNumber(usage, "percentUsed") ?? void 0,
          resetsAt: getNumber(usage, "resetsAt") ?? void 0
        } : void 0,
        usageRowLabel: getString(subscription, "usageRowLabel") ?? void 0,
        topupBalance: getNumber(subscription, "topupBalance") ?? void 0,
        topupTotal: getNumber(subscription, "topupTotal") ?? void 0,
        topupRowLabel: getString(subscription, "topupRowLabel") ?? void 0,
        topupRowValueLabel: getString(subscription, "topupRowValueLabel") ?? void 0
      }
    };
  }
  function parseMuseSubscriptionText(text) {
    for (const line of text.split(/\r?\n/)) {
      const match = /^[0-9a-f]+:(\{.*\})$/i.exec(line);
      if (!match) continue;
      try {
        const result = parseMuseSubscriptionJson(JSON.parse(match[1]));
        if (result) return result;
      } catch {
      }
    }
    return null;
  }
  const SOURCE = "ai-usage-floating-monitor";
  function isBridgeRequest(value) {
    return isRecord(value) && value.source === SOURCE && value.direction === "content-to-main" && typeof value.requestId === "string" && typeof value.action === "string" && typeof value.platform === "string";
  }
  function findMuseSubscriptionAction(script) {
    return /createServerReference\s*\)?\s*\(\s*["']([a-f0-9]{40,64})["'][^;]{0,250}?["']fetchSubscriptionAction["']/i.exec(script)?.[1] ?? null;
  }
  class MuseSubscriptionBridge {
    constructor(fetcher, pageDocument = document, origin = window.location.origin) {
      this.fetcher = fetcher;
      this.pageDocument = pageDocument;
      this.origin = origin;
    }
    actionId = null;
    scannedScripts = /* @__PURE__ */ new Map();
    inFlight = null;
    matches(url, method, actionId) {
      return this.origin === "https://muse.ai" && url.origin === this.origin && url.pathname === "/" && method.toUpperCase() === "POST" && this.actionId !== null && actionId === this.actionId;
    }
    async fetchUsage(requestId) {
      const pending = this.inFlight ?? (this.inFlight = this.queryUsage(requestId));
      try {
        return { ...await pending, requestId };
      } finally {
        if (this.inFlight === pending) this.inFlight = null;
      }
    }
    async queryUsage(requestId) {
      const requestedAt = Date.now();
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 1e4);
      let stage = "discovery";
      const base = {
        source: SOURCE,
        direction: "main-to-content",
        requestId,
        platform: "muse",
        endpointKey: MUSE_ENDPOINT_KEY,
        requestStartedAt: requestedAt
      };
      try {
        if (this.origin !== "https://muse.ai") throw new Error("Muse 额度只能从 Muse 页面查询");
        for (let attempt = 0; attempt < 2; attempt++) {
          stage = "discovery";
          const actionId = this.actionId ?? await this.discoverAction(controller.signal);
          stage = "request";
          const response = await this.fetcher(`${this.origin}/`, {
            method: "POST",
            credentials: "include",
            cache: "no-store",
            signal: controller.signal,
            headers: { Accept: "text/x-component", "Content-Type": "text/plain;charset=UTF-8", "Next-Action": actionId },
            body: '[{"includeAgreement":false}]'
          });
          if (response.redirected && response.url.startsWith("https://auth.muse.ai/")) {
            return { ...base, ok: false, error: { status: 401, message: "请登录 Muse 后刷新额度" } };
          }
          stage = "response";
          const text = await response.text();
          const missingAction = response.status === 404 || response.headers.get("x-nextjs-action-not-found") === "1" || /Failed to find Server Action|Server Action[^\n]*not found/i.test(text);
          if (missingAction) {
            this.actionId = null;
            this.scannedScripts.clear();
            if (attempt === 0) continue;
            return { ...base, ok: false, error: { message: "Muse 额度接口已更新，请重新加载页面" } };
          }
          if (!response.ok) return { ...base, ok: false, error: { status: response.status, message: response.statusText || "Muse 额度接口请求失败" } };
          const result = parseMuseSubscriptionText(text);
          if (!result) return { ...base, ok: false, error: { code: "PARSER_ERROR", message: "Muse 额度响应结构变化" } };
          if (!result.success) return { ...base, ok: false, error: { status: result.unauthorized ? 401 : void 0, message: result.error } };
          return { ...base, ok: true, json: result, observedAt: Date.now() };
        }
        throw new Error("Muse 额度接口已更新，请重新加载页面");
      } catch (error) {
        const timeoutMessage = stage === "discovery" ? "识别 Muse 额度接口超时，请刷新页面后重试" : stage === "request" ? "Muse 额度请求超时，请稍后刷新" : "Muse 额度响应读取超时，请稍后刷新";
        return { ...base, ok: false, error: { code: controller.signal.aborted ? "NETWORK_ERROR" : "UNKNOWN", message: controller.signal.aborted ? timeoutMessage : error instanceof Error ? error.message : "Muse 额度查询失败" } };
      } finally {
        window.clearTimeout(timeout);
      }
    }
    async discoverAction(signal) {
      while (!signal.aborted) {
        const urls = Array.from(new Set(Array.from(this.pageDocument.scripts).map((script) => script.src))).filter((src) => {
          try {
            const url = new URL(src);
            return url.origin === this.origin && /^\/_next\/static\/chunks\/.*\.js$/.test(url.pathname) && !this.scannedScripts.has(src);
          } catch {
            return false;
          }
        }).reverse();
        const actionId = await this.scanScripts(urls, signal);
        if (actionId) return actionId;
        await new Promise((resolve, reject) => {
          if (signal.aborted) {
            reject(new Error("Muse action discovery timed out"));
            return;
          }
          const observer = new MutationObserver(() => {
            cleanup();
            resolve();
          });
          const abort = () => {
            cleanup();
            reject(new Error("Muse action discovery timed out"));
          };
          const cleanup = () => {
            observer.disconnect();
            signal.removeEventListener("abort", abort);
          };
          observer.observe(this.pageDocument, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
          signal.addEventListener("abort", abort, { once: true });
          if (Array.from(this.pageDocument.scripts).some((script) => !this.scannedScripts.has(script.src) && urls.includes(script.src) === false && script.src.startsWith(`${this.origin}/_next/static/chunks/`))) {
            cleanup();
            resolve();
          }
        });
      }
      throw new Error("Muse action discovery timed out");
    }
    scanScripts(urls, signal) {
      if (!urls.length) return Promise.resolve(null);
      const controller = new AbortController();
      return new Promise((resolve, reject) => {
        let nextIndex = 0;
        const workerCount = Math.min(4, urls.length);
        let activeWorkers = workerCount;
        let finished = false;
        const finish = (actionId, error) => {
          if (finished) return;
          finished = true;
          signal.removeEventListener("abort", abort);
          controller.abort();
          if (error) reject(error);
          else resolve(actionId);
        };
        const abort = () => finish(null, new Error("Muse action discovery timed out"));
        const worker = async () => {
          try {
            while (!finished && nextIndex < urls.length) {
              const url = urls[nextIndex++];
              try {
                const response = await this.fetcher(url, { credentials: "same-origin", cache: "force-cache", signal: controller.signal });
                if (!response.ok || finished) continue;
                const actionId = findMuseSubscriptionAction(await response.text());
                if (finished) return;
                this.scannedScripts.set(url, actionId);
                if (actionId) {
                  this.actionId = actionId;
                  finish(actionId);
                }
              } catch {
                if (signal.aborted) abort();
              }
            }
          } finally {
            if (--activeWorkers === 0) finish(null);
          }
        };
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener("abort", abort, { once: true });
        for (let index = 0; index < workerCount; index++) void worker();
      });
    }
  }
  const FETCH_TIMEOUT_MS = 1e4;
  const ownedFetch = window.fetch.bind(window);
  const museSubscription = new MuseSubscriptionBridge(ownedFetch);
  const chatGptControllers = /* @__PURE__ */ new Set();
  let chatGptContext = 0;
  const chatGptImages = new ChatGptImageObserver((signal, context) => {
    postInterceptedUsage({
      platform: "chatgpt",
      endpointKey: "chatgpt:imageGeneration",
      url: "https://chatgpt.com/backend-api/f/conversation",
      json: signal,
      scopeKey: context.scope ?? chatGptSession.scope(),
      requestStartedAt: context.startedAt
    });
  });
  const chatGptSession = new ChatGptSession(ownedFetch, () => {
    chatGptContext++;
    for (const controller of chatGptControllers) controller.abort();
    chatGptImages.reset();
    window.postMessage({ source: SOURCE, direction: "main-to-content", kind: "chatgptContextChanged", platform: "chatgpt" }, window.location.origin);
  });
  const GEMINI_USAGE_RPC_ID = "jSf9Qc";
  const geminiBatchExecuteState = {};
  if (!window.__AI_USAGE_FLOATING_MONITOR_BRIDGE__) {
    window.__AI_USAGE_FLOATING_MONITOR_BRIDGE__ = true;
    installFetchIntercept();
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.origin !== window.location.origin) {
        return;
      }
      if (!isBridgeRequest(event.data)) {
        return;
      }
      void handleRequest(event.data);
    });
  }
  async function handleRequest(request) {
    if (request.action === "enableIntercept") {
      installFetchIntercept();
      postResponse({
        source: SOURCE,
        direction: "main-to-content",
        requestId: request.requestId,
        ok: true,
        platform: request.platform
      });
      return;
    }
    if (!request.endpointKey) {
      postResponse({
        source: SOURCE,
        direction: "main-to-content",
        requestId: request.requestId,
        ok: false,
        platform: request.platform,
        error: { message: "Missing endpointKey" }
      });
      return;
    }
    if (request.platform === "muse" && request.endpointKey === "muse:subscription") {
      postResponse(await museSubscription.fetchUsage(request.requestId));
      return;
    }
    const endpoint = resolveEndpoint(request.platform, request.endpointKey, request.payload);
    if (!endpoint) {
      postResponse({
        source: SOURCE,
        direction: "main-to-content",
        requestId: request.requestId,
        ok: false,
        platform: request.platform,
        endpointKey: request.endpointKey,
        error: {
          message: request.endpointKey === "gemini:usageBatchExecute" ? "Missing Gemini usage replay parameters" : "Endpoint is not allowed"
        }
      });
      return;
    }
    const response = await fetchEndpoint(endpoint, request.requestId, request.endpointKey);
    postResponse(response);
  }
  function resolveEndpoint(platform, endpointKey, payload) {
    const endpoints = {
      "grok:credits-config": {
        platform: "grok",
        method: "POST",
        url: "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig",
        headers: {
          accept: "application/grpc-web+proto",
          "content-type": "application/grpc-web+proto",
          "x-grpc-web": "1"
        },
        body: "\0\0\0\0\0",
        responseType: "base64"
      },
      "claude:organizations": {
        platform: "claude",
        method: "GET",
        url: "https://claude.ai/api/organizations"
      },
      "chatgpt:libraryStorage": {
        platform: "chatgpt",
        method: "GET",
        url: "https://chatgpt.com/backend-api/files/library/storage/usage"
      },
      "chatgpt:conversationInit": {
        platform: "chatgpt",
        method: "POST",
        url: "https://chatgpt.com/backend-api/conversation/init",
        body: {}
      },
      "chatgpt:whamUsage": {
        platform: "chatgpt",
        method: "GET",
        url: "https://chatgpt.com/backend-api/wham/usage"
      },
      "chatgpt:accountsCheck": {
        platform: "chatgpt",
        method: "GET",
        url: `https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=${(/* @__PURE__ */ new Date()).getTimezoneOffset()}`
      },
      "kimi:subscription": {
        platform: "kimi",
        method: "POST",
        url: "https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscription",
        body: {}
      },
      "perplexity:rateLimitAll": {
        platform: "perplexity",
        method: "GET",
        url: "https://www.perplexity.ai/rest/rate-limit/all"
      }
    };
    if (endpointKey === "claude:usage") {
      const payloadRecord = asRecord(payload);
      const orgId = payloadRecord ? getString(payloadRecord, "orgId") : null;
      if (!orgId || !/^[A-Za-z0-9_-]{6,}$/.test(orgId)) {
        return null;
      }
      return {
        platform: "claude",
        method: "GET",
        url: `https://claude.ai/api/organizations/${encodeURIComponent(orgId)}/usage`
      };
    }
    if (endpointKey === "gemini:usageBatchExecute") {
      if (platform !== "gemini") {
        return null;
      }
      return resolveGeminiUsageEndpoint();
    }
    const endpoint = endpoints[endpointKey];
    if (!endpoint || endpoint.platform !== platform) {
      return null;
    }
    return endpoint;
  }
  function resolveGeminiUsageEndpoint() {
    const params = currentGeminiReplayParams();
    if (!params) {
      return null;
    }
    const authPath = params.authuser === "0" ? "" : `/u/${params.authuser}`;
    const url = new URL(
      `https://gemini.google.com${authPath}/_/BardChatUi/data/batchexecute`
    );
    url.searchParams.set("rpcids", GEMINI_USAGE_RPC_ID);
    url.searchParams.set(
      "source-path",
      params.authuser === "0" ? "/usage" : `/u/${params.authuser}/usage`
    );
    url.searchParams.set("bl", params.bl);
    url.searchParams.set("f.sid", params.fSid);
    url.searchParams.set("hl", params.hl);
    url.searchParams.set("_reqid", params.reqid);
    url.searchParams.set("rt", params.rt);
    url.searchParams.set("authuser", params.authuser);
    const body = new URLSearchParams();
    body.set("f.req", JSON.stringify([[[GEMINI_USAGE_RPC_ID, "[]", null, "generic"]]]));
    body.set("at", params.at);
    return {
      platform: "gemini",
      method: "POST",
      url: url.toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "x-goog-authuser": params.authuser
      },
      body: `${body.toString()}&`,
      responseType: "text"
    };
  }
  function currentGeminiReplayParams() {
    const wiz = readGeminiWizGlobalData();
    const at = geminiBatchExecuteState.at ?? wiz.at;
    const bl = geminiBatchExecuteState.bl ?? wiz.bl;
    const fSid = geminiBatchExecuteState.fSid ?? wiz.fSid;
    const authuser = geminiBatchExecuteState.authuser ?? currentGeminiAuthUser();
    if (!at || !bl || !fSid || !authuser) {
      return null;
    }
    return {
      at,
      bl,
      fSid,
      reqid: nextGeminiReqid(geminiBatchExecuteState.reqid),
      rt: geminiBatchExecuteState.rt ?? "c",
      hl: geminiBatchExecuteState.hl ?? pageLanguage(),
      authuser
    };
  }
  function readGeminiWizGlobalData() {
    const data = asRecord(window.WIZ_global_data);
    if (!data) {
      return {};
    }
    return {
      at: getString(data, "SNlM0e") ?? void 0,
      fSid: getString(data, "FdrFJe") ?? void 0,
      bl: getString(data, "cfb2h") ?? void 0
    };
  }
  function nextGeminiReqid(value) {
    const parsed = value ? Number(value) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
      return String(Math.floor(parsed) + 1e5);
    }
    return String(1e5 + Math.floor(Date.now() % 9e4));
  }
  function endpointHeaders(endpoint) {
    if (endpoint.headers) {
      return endpoint.headers;
    }
    if (endpoint.body === void 0) {
      return void 0;
    }
    return {
      "Content-Type": "application/json"
    };
  }
  function endpointBody(endpoint) {
    if (endpoint.body === void 0) {
      return void 0;
    }
    if (typeof endpoint.body === "string") {
      return endpoint.body;
    }
    return JSON.stringify(endpoint.body);
  }
  async function fetchEndpoint(endpoint, requestId, endpointKey) {
    const requestedAt = Date.now();
    const context = chatGptContext;
    let scopeKey;
    const controller = new AbortController();
    if (endpoint.platform === "chatgpt") chatGptControllers.add(controller);
    const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const headers = endpointHeaders(endpoint) ?? {};
      if (endpoint.platform === "chatgpt") {
        const session = await chatGptSession.read();
        if (controller.signal.aborted || context !== chatGptContext) throw new Error("Account context changed");
        headers.Authorization = `Bearer ${session.token}`;
        if (session.account) headers["ChatGPT-Account-ID"] = session.account;
        scopeKey = session.scopeKey;
      }
      const response = await ownedFetch(endpoint.url, {
        method: endpoint.method,
        credentials: "include",
        cache: "no-store",
        headers,
        body: endpointBody(endpoint),
        signal: controller.signal
      });
      if (endpoint.platform === "chatgpt" && (controller.signal.aborted || context !== chatGptContext)) throw new Error("Account context changed");
      if (!response.ok) {
        if (endpoint.platform === "chatgpt" && response.status === 401) chatGptSession.invalidate();
        return {
          source: SOURCE,
          direction: "main-to-content",
          requestId,
          ok: false,
          platform: endpoint.platform,
          endpointKey,
          error: {
            status: response.status,
            message: response.statusText || "Usage endpoint failed"
          }
        };
      }
      if (endpoint.responseType === "base64") {
        return {
          source: SOURCE,
          direction: "main-to-content",
          requestId,
          ok: true,
          platform: endpoint.platform,
          endpointKey,
          text: arrayBufferToBase64(await response.arrayBuffer())
        };
      }
      if (endpoint.responseType === "text") {
        return {
          source: SOURCE,
          direction: "main-to-content",
          requestId,
          ok: true,
          platform: endpoint.platform,
          endpointKey,
          text: await response.text()
        };
      }
      let json;
      try {
        json = await response.json();
      } catch {
        return {
          source: SOURCE,
          direction: "main-to-content",
          requestId,
          ok: false,
          platform: endpoint.platform,
          endpointKey,
          error: {
            status: response.status,
            message: "响应结构变化"
          }
        };
      }
      if (endpoint.platform === "chatgpt" && (controller.signal.aborted || context !== chatGptContext)) throw new Error("Account context changed");
      return {
        source: SOURCE,
        direction: "main-to-content",
        requestId,
        ok: true,
        platform: endpoint.platform,
        endpointKey,
        json,
        ...endpoint.platform === "chatgpt" ? { scopeKey, requestStartedAt: requestedAt, observedAt: Date.now() } : {}
      };
    } catch (error) {
      return {
        source: SOURCE,
        direction: "main-to-content",
        requestId,
        ok: false,
        platform: endpoint.platform,
        endpointKey,
        error: {
          message: error instanceof Error ? error.message : "Network error"
        }
      };
    } finally {
      window.clearTimeout(timeoutId);
      chatGptControllers.delete(controller);
    }
  }
  function installFetchIntercept() {
    if (window.__AI_USAGE_FLOATING_MONITOR_FETCH_PATCHED__) {
      return;
    }
    window.__AI_USAGE_FLOATING_MONITOR_FETCH_PATCHED__ = true;
    const originalFetch = window.fetch.bind(window);
    function makePatchedFetch() {
      return async (input, init) => {
        rememberGeminiBatchExecuteRequest(input, init);
        const requestedAt = Date.now();
        const rawUrl = requestUrl(input);
        if (rawUrl.startsWith("https://chatgpt.com/backend-api/") || rawUrl.startsWith("/backend-api/")) {
          chatGptSession.observeAccount(requestHeaderValue(input, init, "ChatGPT-Account-ID"));
        }
        const scopeKey = chatGptSession.scope();
        const context = chatGptContext;
        const usageRequest = getUsageRequest(input, init);
        const response = await originalFetch(input, init);
        const chatGptRequest = rawUrl.startsWith("https://chatgpt.com/") || rawUrl.startsWith("/backend-api/") || rawUrl === "/api/auth/session";
        if (chatGptRequest && context !== chatGptContext) return response;
        try {
          chatGptImages.observe(rawUrl, input, init, response, requestedAt, scopeKey ?? chatGptSession.scope());
        } catch {
        }
        if (usageRequest?.platform === "muse") {
          if (response.ok) {
            void response.clone().text().then((text) => {
              const json = parseMuseSubscriptionText(text);
              if (json) postInterceptedUsage({ ...usageRequest, json, requestStartedAt: requestedAt });
            }).catch(() => void 0);
          } else if (response.status === 401 || response.status === 403) {
            postInterceptedUsage({ ...usageRequest, json: { success: false, unauthorized: true }, requestStartedAt: requestedAt });
          }
          return response;
        }
        if (rawUrl === "https://chatgpt.com/api/auth/session" || rawUrl === "/api/auth/session") {
          void response.clone().json().then((json) => {
            if (context === chatGptContext) return chatGptSession.observeSession(json);
          }).catch(() => void 0);
        }
        if (usageRequest?.platform === "chatgpt") {
          if (response.ok) {
            void response.clone().json().then((json) => {
              if (context === chatGptContext) postInterceptedUsage({
                ...usageRequest,
                json,
                scopeKey: scopeKey ?? chatGptSession.scope(),
                requestStartedAt: requestedAt
              });
            }).catch(() => void 0);
          }
          return response;
        }
        try {
          if (usageRequest) {
            if (usageRequest.responseType === "base64") {
              const buffer = await response.arrayBuffer();
              const newResponse2 = new Response(buffer.slice(0), {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers
              });
              postInterceptedUsage({
                platform: usageRequest.platform,
                endpointKey: usageRequest.endpointKey,
                url: usageRequest.url,
                text: arrayBufferToBase64(buffer)
              });
              return newResponse2;
            }
            const text = await response.text();
            const newResponse = new Response(text, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers
            });
            let json;
            try {
              json = JSON.parse(text);
            } catch {
            }
            postInterceptedUsage({
              platform: usageRequest.platform,
              endpointKey: usageRequest.endpointKey,
              url: usageRequest.url,
              json,
              text: usageRequest.responseType === "text" ? text : void 0
            });
            return newResponse;
          }
        } catch {
        }
        return response;
      };
    }
    var currentPatchedFetch = makePatchedFetch();
    window.fetch = currentPatchedFetch;
    window.setInterval(() => {
      if (window.fetch !== currentPatchedFetch) {
        currentPatchedFetch = makePatchedFetch();
        window.fetch = currentPatchedFetch;
      }
    }, 2e3);
  }
  function rememberGeminiBatchExecuteRequest(input, init) {
    let rawUrl;
    try {
      rawUrl = requestUrl(input);
    } catch {
      return;
    }
    let url;
    try {
      url = new URL(rawUrl, window.location.origin);
    } catch {
      return;
    }
    if (!isGeminiBatchExecuteUrl(url)) {
      return;
    }
    const authuser = resolveGeminiAuthUser(
      url,
      requestHeaderValue(input, init, "x-goog-authuser")
    );
    if (!hasGeminiUsageRpcId(url.searchParams.get("rpcids"))) {
      rememberGeminiBatchExecuteMetadata(url, authuser);
      return;
    }
    const bodyText = requestBodyText(input, init);
    if (bodyText instanceof Promise) {
      void bodyText.then((text) => {
        rememberGeminiBatchExecuteMetadata(url, authuser, text);
      });
      return;
    }
    rememberGeminiBatchExecuteMetadata(url, authuser, bodyText);
  }
  function rememberGeminiBatchExecuteMetadata(url, authuser, bodyText) {
    setGeminiStateValue("bl", url.searchParams.get("bl"));
    setGeminiStateValue("fSid", url.searchParams.get("f.sid"));
    setGeminiStateValue("reqid", url.searchParams.get("_reqid"));
    setGeminiStateValue("rt", url.searchParams.get("rt"));
    setGeminiStateValue("hl", url.searchParams.get("hl"));
    geminiBatchExecuteState.authuser = authuser;
    if (bodyText) {
      try {
        const params = new URLSearchParams(bodyText);
        setGeminiStateValue("at", params.get("at"));
      } catch {
      }
    }
  }
  function setGeminiStateValue(key, value) {
    if (value) {
      geminiBatchExecuteState[key] = value;
    }
  }
  function requestBodyText(input, init) {
    if (init?.body !== void 0) {
      return bodyTextFromBody(init.body);
    }
    if (input instanceof Request && !input.bodyUsed) {
      return input.clone().text().then((text) => text || void 0).catch(() => void 0);
    }
    return void 0;
  }
  function bodyTextFromBody(body) {
    if (typeof body === "string") {
      return body;
    }
    if (body instanceof URLSearchParams) {
      return body.toString();
    }
    if (body instanceof FormData) {
      const params = new URLSearchParams();
      body.forEach((value, key) => {
        if (typeof value === "string") {
          params.append(key, value);
        }
      });
      return params.toString();
    }
    if (body instanceof Blob) {
      return body.text().then((text) => text || void 0).catch(() => void 0);
    }
    return void 0;
  }
  function requestHeaderValue(input, init, name) {
    return headerValue(init?.headers, name) ?? (input instanceof Request ? input.headers.get(name) : null);
  }
  function headerValue(headers, name) {
    if (!headers) {
      return null;
    }
    const normalizedName = name.toLowerCase();
    if (headers instanceof Headers) {
      return headers.get(name);
    }
    if (Array.isArray(headers)) {
      const pair = headers.find(([key]) => key.toLowerCase() === normalizedName);
      return pair?.[1] ?? null;
    }
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === normalizedName) {
        return value;
      }
    }
    return null;
  }
  function currentGeminiAuthUser() {
    return resolveGeminiAuthUser();
  }
  function resolveGeminiAuthUser(url, headerAuthuser) {
    return sanitizeGeminiAuthUser(headerAuthuser) ?? sanitizeGeminiAuthUser(url?.searchParams.get("authuser")) ?? sanitizeGeminiAuthUser(currentPageUrl().searchParams.get("authuser")) ?? authUserFromPath(window.location.pathname) ?? "0";
  }
  function currentPageUrl() {
    try {
      return new URL(window.location.href);
    } catch {
      return new URL("https://gemini.google.com/");
    }
  }
  function sanitizeGeminiAuthUser(value) {
    return value && /^\d{1,3}$/.test(value) ? value : null;
  }
  function authUserFromPath(pathname) {
    const match = /^\/u\/(\d{1,3})(?:\/|$)/.exec(pathname);
    return match?.[1] ?? null;
  }
  function pageLanguage() {
    const language = document.documentElement.lang || navigator.language || "zh-CN";
    return /^[A-Za-z0-9_-]{2,20}$/.test(language) ? language : "zh-CN";
  }
  function getUsageRequest(input, init) {
    let rawUrl;
    try {
      rawUrl = requestUrl(input);
    } catch {
      return null;
    }
    const info = usageUrlInfo(rawUrl);
    try {
      const url = new URL(rawUrl, window.location.origin);
      if (museSubscription.matches(url, init?.method ?? (input instanceof Request ? input.method : "GET"), requestHeaderValue(input, init, "Next-Action"))) {
        return { platform: "muse", endpointKey: "muse:subscription", url: sanitizeUrl(rawUrl) };
      }
    } catch {
      return null;
    }
    if (!info) {
      return null;
    }
    return {
      platform: info.platform,
      endpointKey: info.endpointKey,
      url: sanitizeUrl(rawUrl),
      responseType: info.responseType
    };
  }
  function postInterceptedUsage(args) {
    const message = {
      source: SOURCE,
      direction: "main-to-content",
      kind: "interceptedUsage",
      platform: args.platform,
      endpointKey: args.endpointKey,
      url: args.url,
      json: args.json,
      text: args.text,
      requestStartedAt: args.requestStartedAt,
      scopeKey: args.scopeKey,
      ts: Date.now()
    };
    window.postMessage(message, window.location.origin);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, window.location.origin);
    }
  }
  function requestUrl(input) {
    if (typeof input === "string") {
      return input;
    }
    if (input instanceof URL) {
      return input.href;
    }
    return input.url;
  }
  function usageUrlInfo(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl, window.location.origin);
    } catch {
      return null;
    }
    if (url.origin === "https://grok.com" && url.pathname === "/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig") {
      return {
        platform: "grok",
        endpointKey: "grok:credits-config",
        responseType: "base64"
      };
    }
    if (url.origin === "https://claude.ai" && /^\/api\/organizations\/[^/]+\/usage$/.test(url.pathname)) {
      return { platform: "claude", endpointKey: "claude:usage" };
    }
    if (url.origin === "https://chatgpt.com") {
      if (url.pathname === "/backend-api/files/library/storage/usage") {
        return { platform: "chatgpt", endpointKey: "chatgpt:libraryStorage" };
      }
      if (url.pathname === "/backend-api/conversation/init") {
        return { platform: "chatgpt", endpointKey: "chatgpt:conversationInit" };
      }
      if (url.pathname === "/backend-api/wham/usage") {
        return { platform: "chatgpt", endpointKey: "chatgpt:whamUsage" };
      }
      if (url.pathname === "/backend-api/codex/usage") {
        return { platform: "chatgpt", endpointKey: "chatgpt:codexUsage" };
      }
      if (url.pathname === "/backend-api/wham/tasks/rate_limit") {
        return {
          platform: "chatgpt",
          endpointKey: "chatgpt:whamTasksRateLimit"
        };
      }
      if (/^\/backend-api\/accounts\/check\//.test(url.pathname)) {
        return {
          platform: "chatgpt",
          endpointKey: "chatgpt:accountsCheck"
        };
      }
    }
    if (url.origin === "https://www.kimi.com" && url.pathname === "/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscription") {
      return { platform: "kimi", endpointKey: "kimi:subscription" };
    }
    if (url.origin === "https://www.perplexity.ai" && url.pathname === "/rest/rate-limit/all") {
      return { platform: "perplexity", endpointKey: "perplexity:rateLimitAll" };
    }
    if (isGeminiBatchExecuteUrl(url) && hasGeminiUsageRpcId(url.searchParams.get("rpcids"))) {
      return {
        platform: "gemini",
        endpointKey: "gemini:usageBatchExecute",
        responseType: "text"
      };
    }
    return null;
  }
  function isGeminiBatchExecuteUrl(url) {
    return url.origin === "https://gemini.google.com" && /^\/(?:u\/\d{1,3}\/)?_\/BardChatUi\/data\/batchexecute$/.test(url.pathname);
  }
  function hasGeminiUsageRpcId(value) {
    return value?.split(",").includes(GEMINI_USAGE_RPC_ID) ?? false;
  }
  function sanitizeUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, window.location.origin);
      return `${url.origin}${url.pathname}`;
    } catch {
      return "";
    }
  }
  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 32768;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }
  function postResponse(response) {
    window.postMessage(response, window.location.origin);
  }
})();
