import * as crypto from "node:crypto";

import type { ILogger, OAuthClient } from "../../../src/index";
import { PkceLoopbackAuth, type PkceLoopbackOptions } from "../../../src/sync/node/index";
import { fakeFetch, httpGet, redirectWithCode, scriptedBrowser, tokenResponse } from "../../support/oauthHarness";
import { MemoryTokenStore } from "../../support/syncFakes";

const CLIENT: OAuthClient = { clientId: "cid.apps.googleusercontent.com", clientSecret: "csecret" };

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function exchangeFetch(body: Record<string, unknown> = { refresh_token: "refresh-from-login" }): ReturnType<typeof fakeFetch> {
  return fakeFetch(() => tokenResponse({ access_token: "access-from-login", ...body }));
}

function newAuth(store: MemoryTokenStore, fn: typeof fetch, options: Partial<PkceLoopbackOptions> = {}, client: OAuthClient | null = CLIENT): PkceLoopbackAuth {
  return new PkceLoopbackAuth(client ?? undefined, store, fn, { openBrowser: () => undefined, ...options });
}

function recordingLogger(): { logger: ILogger; entries: Array<{ level: string; message: string }> } {
  const entries: Array<{ level: string; message: string }> = [];
  return { logger: { log: async (level, _module, message) => { entries.push({ level, message }); }, error: async () => undefined }, entries };
}

describe("PkceLoopbackAuth.login", () => {
  it("opens an S256 PKCE authorization URL on a 127.0.0.1 redirect, exchanges the code and stores the tokens", async () => {
    const store = new MemoryTokenStore();
    const { fn, calls } = exchangeFetch();
    const auth = newAuth(store, fn);
    const given: string[] = [];
    const b = scriptedBrowser(redirectWithCode("abc"));
    const before = Date.now();

    await auth.login({ openBrowser: b.open, onUrl: (url) => given.push(url) });
    await b.done;

    expect(b.urls).toHaveLength(1);
    expect(given).toEqual(b.urls);
    const url = new URL(b.urls[0]!);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(CLIENT.clientId);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(url.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")!.split(" ")).toEqual([
      "https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/drive.appdata",
    ]);

    expect(b.statuses).toEqual([200]);
    expect(b.bodies[0]).toContain("LabShelf is connected to Google Drive. You can close this tab.");

    // The exchange proves possession of the verifier behind the challenge.
    expect(calls).toHaveLength(1);
    const exchange = Object.fromEntries(calls[0]!.body);
    expect(exchange).toMatchObject({
      grant_type: "authorization_code", code: "abc", redirect_uri: url.searchParams.get("redirect_uri"),
      client_id: CLIENT.clientId, client_secret: "csecret",
    });
    expect(base64url(crypto.createHash("sha256").update(exchange["code_verifier"]!).digest())).toBe(url.searchParams.get("code_challenge"));

    expect(store.saves).toHaveLength(1);
    expect(store.tokens).toMatchObject({ access_token: "access-from-login", refresh_token: "refresh-from-login" });
    expect(store.tokens!.expiry_ms).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(auth.isAuthenticated()).toBe(true);
    expect(await auth.getAccessToken()).toBe("access-from-login");
    expect(calls).toHaveLength(1);
  });

  it("uses the prompt given at construction, with the app's success message in the browser tab", async () => {
    const b = scriptedBrowser(redirectWithCode("abc"));
    const auth = newAuth(new MemoryTokenStore(), exchangeFetch().fn, { openBrowser: b.open, successMessage: "Connected. Return to the terminal." });
    await auth.login();
    await b.done;
    expect(b.bodies[0]).toContain("Connected. Return to the terminal.");
  });

  it("authenticate() runs the login when not signed in", async () => {
    const b = scriptedBrowser(redirectWithCode("abc"));
    const store = new MemoryTokenStore();
    const auth = newAuth(store, exchangeFetch().fn, { openBrowser: b.open });
    await auth.authenticate();
    await b.done;
    expect(b.urls).toHaveLength(1);
    expect(store.saves).toHaveLength(1);
  });

  it("uses a fresh verifier, challenge and state for every login", async () => {
    const challenges: string[] = [];
    const states: string[] = [];
    for (let i = 0; i < 2; i++) {
      const b = scriptedBrowser(redirectWithCode("c"));
      await newAuth(new MemoryTokenStore(), exchangeFetch().fn).login({ openBrowser: b.open });
      await b.done;
      const url = new URL(b.urls[0]!);
      challenges.push(url.searchParams.get("code_challenge")!);
      states.push(url.searchParams.get("state")!);
    }
    expect(new Set(challenges).size).toBe(2);
    expect(new Set(states).size).toBe(2);
  });

  it("rejects a redirect with the wrong state (HTTP 400) and keeps waiting for the real one", async () => {
    const store = new MemoryTokenStore();
    const { fn, calls } = exchangeFetch();
    const b = scriptedBrowser((u) => ["/?code=evil&state=forged", `/?code=good&state=${u.searchParams.get("state")}`]);

    await newAuth(store, fn).login({ openBrowser: b.open });
    await b.done;

    expect(b.statuses).toEqual([400, 200]);
    expect(b.bodies[0]).toContain("does not belong to the running login");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.get("code")).toBe("good");
    expect(store.tokens?.refresh_token).toBe("refresh-from-login");
  });

  it("rejects a redirect without a state at all, and one with an error but a wrong state", async () => {
    const { fn, calls } = exchangeFetch();
    const b = scriptedBrowser((u) => ["/?code=nostate", "/?error=access_denied&state=forged", `/?code=ok&state=${u.searchParams.get("state")}`]);
    await newAuth(new MemoryTokenStore(), fn).login({ openBrowser: b.open });
    await b.done;
    expect(b.statuses).toEqual([400, 400, 200]);
    expect(calls[0]!.body.get("code")).toBe("ok");
  });

  it("ignores requests that carry neither a code nor an error (a favicon fetch)", async () => {
    const b = scriptedBrowser((u) => ["/favicon.ico", `/?code=abc&state=${u.searchParams.get("state")}`]);
    await newAuth(new MemoryTokenStore(), exchangeFetch().fn).login({ openBrowser: b.open });
    await b.done;
    expect(b.statuses).toEqual([204, 200]);
  });

  it("fails and stores nothing when the user cancels (error=access_denied)", async () => {
    const store = new MemoryTokenStore();
    const { fn, calls } = exchangeFetch();
    const auth = newAuth(store, fn);
    const b = scriptedBrowser((u) => [`/?error=access_denied&state=${u.searchParams.get("state")}`]);

    await expect(auth.login({ openBrowser: b.open })).rejects.toThrow("Sign-in cancelled (access_denied)");
    await b.done;

    expect(b.bodies[0]).toContain("cancelled");
    expect(calls).toEqual([]);
    expect(store.saves).toEqual([]);
    expect(auth.isAuthenticated()).toBe(false);
  });

  it("times out when the browser never calls back, and closes its server", async () => {
    const store = new MemoryTokenStore();
    const { logger, entries } = recordingLogger();
    let redirect = "";

    await expect(newAuth(store, exchangeFetch().fn, { logger }).login({
      timeoutMs: 80,
      onUrl: (url) => { redirect = new URL(url).searchParams.get("redirect_uri")!; },
    })).rejects.toThrow("Sign-in timed out");

    expect(store.saves).toEqual([]);
    expect(entries.map((e) => e.message)).toContain("Google sign-in failed");
    await expect(httpGet(`${redirect}/?code=late&state=x`)).rejects.toThrow(/ECONNREFUSED/);
  });

  it("waits five minutes by default", async () => {
    const timeouts = jest.spyOn(globalThis, "setTimeout");
    try {
      const b = scriptedBrowser(redirectWithCode("abc"));
      await newAuth(new MemoryTokenStore(), exchangeFetch().fn).login({ openBrowser: b.open });
      await b.done;
      expect(timeouts.mock.calls.map(([, delay]) => delay)).toContain(5 * 60_000);
    } finally {
      timeouts.mockRestore();
    }
  });

  it("carries on when the browser launcher throws (the URL was handed to onUrl)", async () => {
    const b = scriptedBrowser(redirectWithCode("abc"));
    const { logger, entries } = recordingLogger();
    const auth = newAuth(new MemoryTokenStore(), exchangeFetch().fn, { logger });
    await auth.login({ openBrowser: () => { throw new Error("no browser installed"); }, onUrl: (url) => b.open(url) });
    await b.done;
    expect(auth.isAuthenticated()).toBe(true);
    expect(entries).toContainEqual({ level: "WARN", message: "Could not open the browser for Google sign-in" });
  });

  it("carries on when an async browser launcher rejects, still waiting for the redirect", async () => {
    const b = scriptedBrowser(redirectWithCode("abc"));
    const { logger, entries } = recordingLogger();
    const auth = newAuth(new MemoryTokenStore(), exchangeFetch().fn, { logger });
    await auth.login({ openBrowser: async () => { throw new Error("openExternal failed"); }, onUrl: (url) => setTimeout(() => b.open(url), 20) });
    await b.done;
    expect(auth.isAuthenticated()).toBe(true);
    expect(entries).toContainEqual({ level: "WARN", message: "Could not open the browser for Google sign-in" });
  });

  it("fails when Google returns no refresh token, without storing anything", async () => {
    const store = new MemoryTokenStore();
    const auth = newAuth(store, exchangeFetch({ refresh_token: undefined }).fn);
    const b = scriptedBrowser(redirectWithCode("abc"));
    await expect(auth.login({ openBrowser: b.open })).rejects.toThrow(/did not return a refresh token/);
    await b.done;
    expect(store.saves).toEqual([]);
    expect(auth.isAuthenticated()).toBe(false);
  });

  it("surfaces a failed code exchange", async () => {
    const store = new MemoryTokenStore();
    const auth = newAuth(store, fakeFetch(() => new Response('{"error":"invalid_client"}', { status: 401 })).fn);
    const b = scriptedBrowser(redirectWithCode("abc"));
    await expect(auth.login({ openBrowser: b.open })).rejects.toThrow(/Google token request failed: HTTP 401/);
    await b.done;
    expect(store.saves).toEqual([]);
  });

  it("refuses to start without an OAuth client, opening no browser", async () => {
    const open = jest.fn();
    await expect(newAuth(new MemoryTokenStore(), exchangeFetch().fn, {}, null).login({ openBrowser: open })).rejects.toThrow(/No Google OAuth client configured/);
    expect(open).not.toHaveBeenCalled();
  });

  it("logs the sign-in start and success but neither the code nor the tokens", async () => {
    const { logger, entries } = recordingLogger();
    const b = scriptedBrowser(redirectWithCode("the-auth-code"));
    await newAuth(new MemoryTokenStore(), exchangeFetch().fn, { logger }).login({ openBrowser: b.open });
    await b.done;
    expect(entries.map((e) => e.message)).toEqual(["Google sign-in started", "Google sign-in completed"]);
    expect(JSON.stringify(entries)).not.toMatch(/the-auth-code|refresh-from-login|access-from-login/);
  });
});
