import { ReauthRequiredError, type ILogger, type OAuthClient, type TokenData } from "../../../src/index";
import { PkceLoopbackAuth, type PkceLoopbackOptions } from "../../../src/sync/node/index";
import { fakeFetch, tokenResponse } from "../../support/oauthHarness";
import { MemoryTokenStore } from "../../support/syncFakes";

const CLIENT: OAuthClient = { clientId: "cid.apps.googleusercontent.com", clientSecret: "csecret" };
const FRESH: TokenData = { access_token: "access-live", refresh_token: "refresh-1", expiry_ms: Date.now() + 3_600_000 };
const EXPIRED: TokenData = { access_token: "access-old", refresh_token: "refresh-1", expiry_ms: Date.now() - 1000 };

function authWith(store: MemoryTokenStore, fn?: typeof fetch, options: Partial<PkceLoopbackOptions> = {}, client: OAuthClient | null = CLIENT): PkceLoopbackAuth {
  return new PkceLoopbackAuth(client ?? undefined, store, fn ?? fakeFetch(() => tokenResponse()).fn, { openBrowser: () => undefined, ...options });
}

function recordingLogger(): { logger: ILogger; entries: Array<{ level: string; message: string; context: unknown }> } {
  const entries: Array<{ level: string; message: string; context: unknown }> = [];
  const logger: ILogger = {
    log: async (level, _module, message, context) => { entries.push({ level, message, context }); },
    error: async () => undefined,
  };
  return { logger, entries };
}

describe("PkceLoopbackAuth: state", () => {
  it("reports whether a client is configured and where tokens live", () => {
    const store = new MemoryTokenStore();
    expect(authWith(store).isConfigured()).toBe(true);
    expect(authWith(store, undefined, {}, null).isConfigured()).toBe(false);
    expect(authWith(store).storeKind).toBe("file");
  });

  it("is not authenticated until load() found stored tokens", async () => {
    const auth = authWith(new MemoryTokenStore({ ...FRESH }));
    expect(auth.isAuthenticated()).toBe(false);
    await auth.load();
    expect(auth.isAuthenticated()).toBe(true);
  });

  it("stays unauthenticated when the store is empty", async () => {
    const auth = authWith(new MemoryTokenStore());
    await auth.load();
    expect(auth.isAuthenticated()).toBe(false);
  });

  it("loads the store only once", async () => {
    const store = new MemoryTokenStore({ ...FRESH });
    const auth = authWith(store);
    await auth.load();
    await auth.load();
    await auth.getAccessToken();
    expect(store.loads).toBe(1);
  });

  it("authenticate() keeps stored tokens without opening a browser", async () => {
    const open = jest.fn();
    const auth = authWith(new MemoryTokenStore({ ...FRESH }), undefined, { openBrowser: open });
    await auth.authenticate();
    expect(open).not.toHaveBeenCalled();
    expect(auth.isAuthenticated()).toBe(true);
  });
});

describe("PkceLoopbackAuth.getAccessToken", () => {
  it("throws ReauthRequiredError with the app's sign-in hint when not signed in", async () => {
    const { fn, calls } = fakeFetch(() => tokenResponse());
    const auth = authWith(new MemoryTokenStore(), fn, { signInHint: "Run the connect command." });
    const error = await auth.getAccessToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReauthRequiredError);
    expect((error as Error).message).toBe("Not signed in to Google Drive. Run the connect command.");
    expect(calls).toEqual([]);
  });

  it("returns a still-valid access token without calling Google", async () => {
    const { fn, calls } = fakeFetch(() => tokenResponse());
    expect(await authWith(new MemoryTokenStore({ ...FRESH }), fn).getAccessToken()).toBe("access-live");
    expect(calls).toEqual([]);
  });

  it("refreshes an expired token and saves the new tokens, keeping the refresh token", async () => {
    const store = new MemoryTokenStore({ ...EXPIRED });
    const { fn, calls } = fakeFetch(() => tokenResponse({ access_token: "access-refreshed" }));

    expect(await authWith(store, fn).getAccessToken()).toBe("access-refreshed");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.get("grant_type")).toBe("refresh_token");
    expect(store.saves).toHaveLength(1);
    expect(store.tokens).toMatchObject({ access_token: "access-refreshed", refresh_token: "refresh-1" });
  });

  it("refreshes a token that expires within the next minute, and one without an access token", async () => {
    for (const tokens of [{ ...FRESH, expiry_ms: Date.now() + 30_000 }, { ...FRESH, access_token: "" }]) {
      const { fn, calls } = fakeFetch(() => tokenResponse());
      expect(await authWith(new MemoryTokenStore(tokens), fn).getAccessToken()).toBe("access-new");
      expect(calls).toHaveLength(1);
    }
  });

  it("does not refresh twice once the new token is valid", async () => {
    const { fn, calls } = fakeFetch(() => tokenResponse());
    const auth = authWith(new MemoryTokenStore({ ...EXPIRED }), fn);
    await auth.getAccessToken();
    await auth.getAccessToken();
    expect(calls).toHaveLength(1);
  });

  it("lets concurrent callers share one refresh, so a rotated refresh token is spent once", async () => {
    const store = new MemoryTokenStore({ ...EXPIRED });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { fn, calls } = fakeFetch(async () => { await gate; return tokenResponse({ refresh_token: "rotated" }); });
    const auth = authWith(store, fn);

    const pending = Promise.all([auth.getAccessToken(), auth.getAccessToken(), auth.getAccessToken()]);
    await new Promise((resolve) => setImmediate(resolve));
    release();

    expect(await pending).toEqual(["access-new", "access-new", "access-new"]);
    expect(calls).toHaveLength(1);
    expect(store.saves).toHaveLength(1);
    expect(store.tokens?.refresh_token).toBe("rotated");
  });

  it("starts a new refresh after a failed one", async () => {
    let attempt = 0;
    const { fn, calls } = fakeFetch(() => (++attempt === 1 ? new Response("boom", { status: 500 }) : tokenResponse()));
    const auth = authWith(new MemoryTokenStore({ ...EXPIRED }), fn);
    await expect(auth.getAccessToken()).rejects.toThrow("HTTP 500");
    expect(await auth.getAccessToken()).toBe("access-new");
    expect(calls).toHaveLength(2);
  });

  it.each([400, 401])("clears the tokens, logs it and demands a new sign-in on invalid_grant (HTTP %i)", async (status) => {
    const store = new MemoryTokenStore({ ...EXPIRED });
    const { fn } = fakeFetch(() => new Response('{"error":"invalid_grant"}', { status }));
    const { logger, entries } = recordingLogger();
    const auth = authWith(store, fn, { logger, signInHint: "Run the connect command." });

    const error = await auth.getAccessToken().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ReauthRequiredError);
    expect((error as Error).message).toBe("Google Drive access expired or was revoked. Run the connect command.");
    expect(store.cleared).toBe(1);
    expect(store.tokens).toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
    expect(entries.map((e) => e.level)).toContain("WARN");
  });

  it("keeps the tokens on a transient error", async () => {
    const store = new MemoryTokenStore({ ...EXPIRED });
    const auth = authWith(store, fakeFetch(() => new Response("internal error", { status: 500 })).fn);
    const error = await auth.getAccessToken().catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ReauthRequiredError);
    expect(store.cleared).toBe(0);
    expect(auth.isAuthenticated()).toBe(true);
  });

  it("fails clearly when a refresh is needed but no OAuth client is configured", async () => {
    const auth = authWith(new MemoryTokenStore({ ...EXPIRED }), undefined, {}, null);
    await expect(auth.getAccessToken()).rejects.toThrow(/No Google OAuth client configured/);
  });

  it("logs a refresh without ever writing a token", async () => {
    const { logger, entries } = recordingLogger();
    await authWith(new MemoryTokenStore({ ...EXPIRED }), fakeFetch(() => tokenResponse({ access_token: "secret-access" })).fn, { logger }).getAccessToken();
    expect(entries.map((e) => e.message)).toContain("Google access token refreshed");
    expect(JSON.stringify(entries)).not.toMatch(/secret-access|refresh-1|access-old/);
  });
});

describe("PkceLoopbackAuth.revoke", () => {
  it("revokes the refresh token at Google and forgets the tokens", async () => {
    const store = new MemoryTokenStore({ ...FRESH, refresh_token: "refresh/with+chars" });
    const { fn, calls } = fakeFetch(() => new Response("", { status: 200 }));
    const auth = authWith(store, fn);

    await auth.revoke();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent("refresh/with+chars")}`);
    expect(store.tokens).toBeNull();
    expect(store.cleared).toBe(1);
    expect(auth.isAuthenticated()).toBe(false);
  });

  it("still signs out, and logs a warning, when Google cannot be reached", async () => {
    const store = new MemoryTokenStore({ ...FRESH });
    const { logger, entries } = recordingLogger();
    const auth = authWith(store, (async () => { throw new Error("offline"); }) as typeof fetch, { logger });

    await expect(auth.revoke()).resolves.toBeUndefined();

    expect(store.tokens).toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
    expect(entries).toContainEqual(expect.objectContaining({ level: "WARN", context: { message: "offline" } }));
    expect(JSON.stringify(entries)).not.toContain("refresh-1");
  });

  it("does not call Google when nobody is signed in, but still clears the store", async () => {
    const store = new MemoryTokenStore();
    const { fn, calls } = fakeFetch(() => new Response(""));
    await authWith(store, fn).revoke();
    expect(calls).toEqual([]);
    expect(store.cleared).toBe(1);
  });
});
