import { asRecord, getRecord, getString } from "../utils/safeJson";

type Session = { token: string; user?: string; account?: string; scopeKey?: string; expires: number };

// Authentication material never leaves the main world or enters storage/messages.
export class ChatGptSession {
  private cached?: Session;
  private flight?: Promise<Session>;
  private account?: string;
  private accountKnown = false;
  private user?: string;
  private epoch = 0;

  constructor(private fetcher: typeof fetch, private changed: () => void, private now = Date.now) {}

  observeAccount(value: string | null): void {
    if (value === null) return;
    const account = value.trim() || undefined;
    if (this.accountKnown && account === this.account) return;
    this.account = account;
    this.accountKnown = true;
    this.invalidate();
    this.changed();
  }

  invalidate(): void { this.epoch++; this.cached = undefined; this.flight = undefined; }

  async observeSession(json: unknown): Promise<void> {
    const root = asRecord(json);
    const user = root ? getRecord(root, "user") : null;
    const id = user ? getString(user, "id") ?? undefined : undefined;
    if (id && this.user && id !== this.user) {
      this.user = id;
      this.account = undefined;
      this.accountKnown = false;
      this.invalidate();
      this.changed();
    }
  }

  scope(): string | undefined { return this.cached?.scopeKey; }

  read(): Promise<Session> {
    if (this.cached && this.cached.expires > this.now()) return Promise.resolve(this.cached);
    if (this.flight) return this.flight;
    const epoch = this.epoch;
    const account = this.account;
    const accountKnown = this.accountKnown;
    const flight = (async (): Promise<Session> => {
      const response = await this.fetcher("https://chatgpt.com/api/auth/session", { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(10_000) });
      const root = response.ok ? asRecord(await response.json()) : null;
      const token = root ? getString(root, "accessToken") ?? getString(root, "access_token") : null;
      if (!token) throw new Error("ChatGPT session unavailable");
      const userRecord = root ? getRecord(root, "user") : null;
      const user = userRecord ? getString(userRecord, "id") ?? undefined : undefined;
      if (epoch !== this.epoch) throw new Error("Account context changed");
      if (user && this.user && user !== this.user) {
        this.user = user;
        this.account = undefined;
        this.accountKnown = false;
        this.invalidate();
        this.changed();
        throw new Error("Account context changed");
      }
      this.user = user;
      const scopeKey = user && accountKnown ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${user}|${account ?? "personal"}`))))
        .map((byte) => byte.toString(16).padStart(2, "0")).join("") : undefined;
      if (epoch !== this.epoch) throw new Error("Account context changed");
      const result = { token, user, account, scopeKey, expires: this.now() + 60_000 };
      this.cached = result;
      return result;
    })();
    this.flight = flight;
    void flight.finally(() => { if (this.flight === flight) this.flight = undefined; }).catch(() => undefined);
    return flight;
  }
}
