import { describe, expect, it, vi } from "vitest";
import { ChatGptSession } from "../src/injected/chatgptSession";

describe("page-memory session reuse", () => {
  it("shares concurrent requests and expires after 60 seconds", async () => {
    let now = 1_000;
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ accessToken: "synthetic-token", user: { id: "synthetic-user" } })));
    const session = new ChatGptSession(fetcher as typeof fetch, vi.fn(), () => now);
    session.observeAccount("");
    const [a, b] = await Promise.all([session.read(), session.read()]);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(a).toEqual(b);
    expect(a.scopeKey).toMatch(/^[a-f0-9]{64}$/); expect(a.scopeKey).not.toContain("synthetic");
    now += 60_000; await session.read(); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("invalidates account scope and reports context changes", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ accessToken: "synthetic-token", user: { id: "synthetic-user" } })));
    const changed = vi.fn(); const session = new ChatGptSession(fetcher as typeof fetch, changed);
    session.observeAccount(""); changed.mockClear();
    const personal = await session.read(); session.observeAccount("synthetic-workspace"); const workspace = await session.read();
    expect(workspace.scopeKey).not.toBe(personal.scopeKey); expect(changed).toHaveBeenCalledOnce();
    await session.observeSession({ user: { id: "another-synthetic-user" } }); expect(changed).toHaveBeenCalledTimes(2);
  });
  it("does not infer a known personal account merely from a signed-in user", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ accessToken: "synthetic-token", user: { id: "synthetic-user" } })));
    const session = new ChatGptSession(fetcher as typeof fetch, vi.fn());
    expect((await session.read()).scopeKey).toBeUndefined();
    session.observeAccount("synthetic-workspace");
    expect((await session.read()).scopeKey).toMatch(/^[a-f0-9]{64}$/);
  });
});
