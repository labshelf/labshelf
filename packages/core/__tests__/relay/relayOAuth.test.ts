/** Pins the Cloudflare sign-in: the request (PKCE S256, state, scopes, exact redirect), the callback check, the code exchange and the token refresh. */
import { createHash } from "node:crypto";

import {
  CloudflareOauthError, createCloudflareSession, createStoredLock, fetchCloudflareTokens, readAuthorizationCode, startCloudflareAuthorization,
  type StoredSecret,
} from "../../src/relay/index";
import { recordingLogger, TOKEN } from "./fakeCloudflare";
import { CLIENT_ID, fakeClock, fakeOAuthServer, memorySlot, REDIRECT } from "./fakeOAuthServer";

const NOW = 5_000_000;
const exchange = (server: ReturnType<typeof fakeOAuthServer>, code: string, verifier: string, logger = recordingLogger()) =>
  fetchCloudflareTokens({ code, verifier, fetch: server.fetch, logger, now: () => NOW });

describe("startCloudflareAuthorization", () => {
  it("asks for the relay scopes with an S256 challenge of the verifier and a fresh state", async () => {
    const first = await startCloudflareAuthorization();
    const second = await startCloudflareAuthorization();
    const url = new URL(first.url);
    const params = url.searchParams;
    expect(`${url.origin}${url.pathname}`).toBe("https://dash.cloudflare.com/oauth2/auth");
    expect(params.get("response_type")).toBe("code");
    expect(params.get("client_id")).toBe(CLIENT_ID);
    expect(params.get("redirect_uri")).toBe(REDIRECT);
    expect(params.get("scope")).toBe("workers-scripts.admin workers-kv-storage.write account-settings.read user-details.read account-analytics.read offline_access");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toBe(createHash("sha256").update(first.verifier).digest("base64url"));
    expect(params.get("state")).toBe(first.state);
    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(second.state).not.toBe(first.state);
    expect(second.verifier).not.toBe(first.verifier);
  });
});

describe("readAuthorizationCode", () => {
  it("returns the code of a callback whose state matches", async () => {
    const server = fakeOAuthServer();
    const { url, state } = await startCloudflareAuthorization();
    expect(readAuthorizationCode(server.approve(url), state)).toBe("code-1");
  });

  it("refuses a callback with another state", async () => {
    const server = fakeOAuthServer();
    const { url, state } = await startCloudflareAuthorization();
    const callback = server.approve(url, { state: "forged" });
    expect(() => readAuthorizationCode(callback, state)).toThrow(expect.objectContaining({ code: "state_mismatch" }) as Error);
  });

  it("surfaces the error the consent screen returned", async () => {
    const server = fakeOAuthServer();
    const { url, state } = await startCloudflareAuthorization();
    const callback = server.approve(url, { error: "access_denied" });
    expect(() => readAuthorizationCode(callback, state)).toThrow(CloudflareOauthError);
    expect(() => readAuthorizationCode(callback, state)).toThrow(expect.objectContaining({ code: "access_denied" }) as Error);
  });
});

describe("fetchCloudflareTokens", () => {
  it("trades the code and the verifier for tokens that expire after expires_in", async () => {
    const server = fakeOAuthServer();
    const { url, state, verifier } = await startCloudflareAuthorization();
    const logger = recordingLogger();
    const tokens = await exchange(server, readAuthorizationCode(server.approve(url), state), verifier, logger);
    expect(tokens).toEqual({ accessToken: "access-1", refreshToken: "refresh-1", expiresAt: NOW + 3600_000 });
    expect(JSON.stringify(logger.calls)).not.toMatch(/access-1|refresh-1|code-1/);
  });

  it("is refused with a verifier that does not match the challenge", async () => {
    const server = fakeOAuthServer();
    const { url, state } = await startCloudflareAuthorization();
    const code = readAuthorizationCode(server.approve(url), state);
    await expect(exchange(server, code, TOKEN)).rejects.toMatchObject({ name: "CloudflareOauthError", code: "invalid_grant" });
  });
});

type Server = ReturnType<typeof fakeOAuthServer>;
type Clock = ReturnType<typeof fakeClock>;

/** Signs in on the fake server so its first refresh token is live, and stores those tokens as expired. */
function signedIn(server: Server, clock: Clock) {
  server.liveRefresh.add("refresh-0");
  return memorySlot(JSON.stringify({ accessToken: "access-0", refreshToken: "refresh-0", expiresAt: clock.now() - 1 }));
}

function session(server: Server, clock: Clock, tokens: StoredSecret, lockSlot = memorySlot()) {
  const logger = recordingLogger();
  return { logger, session: createCloudflareSession({ tokens, lock: createStoredLock(lockSlot, clock), fetch: server.fetch, logger, clock }) };
}

describe("createCloudflareSession", () => {
  it("uses a stored access token that has not expired without refreshing", async () => {
    const server = fakeOAuthServer();
    const clock = fakeClock();
    const tokens = memorySlot(JSON.stringify({ accessToken: "access-0", refreshToken: "refresh-0", expiresAt: clock.now() + 600_000 }));
    expect(await session(server, clock, tokens).session.accessToken()).toBe("access-0");
    expect(server.grants).toEqual([]);
  });

  it("refreshes an expired token and stores the rotated refresh token", async () => {
    const server = fakeOAuthServer();
    const clock = fakeClock();
    const tokens = signedIn(server, clock);
    const { session: s, logger } = session(server, clock, tokens);
    expect(await s.accessToken()).toBe("access-1");
    expect(JSON.parse(tokens.value ?? "")).toEqual({ accessToken: "access-1", refreshToken: "refresh-1", expiresAt: clock.now() + 3600_000 });
    expect(JSON.stringify(logger.calls)).not.toMatch(/access-1|refresh-[01]/);
  });

  it("does not hand out the access token when the rotated tokens cannot be stored", async () => {
    const server = fakeOAuthServer();
    const clock = fakeClock();
    const tokens = signedIn(server, clock);
    tokens.store = async () => { throw new Error("keychain locked"); };
    await expect(session(server, clock, tokens).session.accessToken()).rejects.toThrow("keychain locked");
  });

  it("surfaces a refused refresh token as invalid_grant", async () => {
    const server = fakeOAuthServer();
    const clock = fakeClock();
    const tokens = memorySlot(JSON.stringify({ accessToken: "access-0", refreshToken: "stale", expiresAt: clock.now() - 1 }));
    const { session: s, logger } = session(server, clock, tokens);
    const failure = await s.accessToken().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CloudflareOauthError);
    expect(failure).toMatchObject({ code: "invalid_grant" });
    expect(logger.calls.length).toBeGreaterThan(0);
  });

  it("refuses with not_signed_in when no tokens are stored", async () => {
    await expect(session(fakeOAuthServer(), fakeClock(), memorySlot()).session.accessToken()).rejects.toMatchObject({ code: "not_signed_in" });
  });

  it("lets two windows sharing the store refresh once, both getting the rotated token", async () => {
    const server = fakeOAuthServer();
    const clock = fakeClock();
    const tokens = signedIn(server, clock);
    const lockSlot = memorySlot();
    const first = session(server, clock, tokens, lockSlot).session;
    const second = session(server, clock, tokens, lockSlot).session;
    expect(await Promise.all([first.accessToken(), second.accessToken()])).toEqual(["access-1", "access-1"]);
    expect(server.grants).toEqual(["refresh_token"]);
    expect(lockSlot.value).toBeUndefined();
  });

  it("takes over a lock a crashed window left behind", async () => {
    const server = fakeOAuthServer();
    const clock = fakeClock();
    const tokens = signedIn(server, clock);
    const lockSlot = memorySlot(JSON.stringify({ owner: "crashed", at: clock.now() }));
    expect(await session(server, clock, tokens, lockSlot).session.accessToken()).toBe("access-1");
    expect(lockSlot.value).toBeUndefined();
  });
});

/** A token endpoint that records the form it receives and answers with valid tokens. */
function recordingTokenEndpoint() {
  const seen: { url: string; method: string | undefined; form: URLSearchParams }[] = [];
  const doFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), method: init?.method, form: new URLSearchParams(String(init?.body)) });
    return new Response(JSON.stringify({ access_token: "access-9", refresh_token: "refresh-9", expires_in: 3600, token_type: "bearer" }), { status: 200 });
  }) as typeof fetch;
  return { doFetch, seen };
}

const PAGE_REDIRECT = "https://labshelf.org/open/";

describe("startCloudflareAuthorization with options", () => {
  it("2.3a keeps the loopback redirect and the full scope list when called with no options or an empty object", async () => {
    for (const started of [await startCloudflareAuthorization(), await startCloudflareAuthorization({})]) {
      const params = new URL(started.url).searchParams;
      expect(params.get("redirect_uri")).toBe(REDIRECT);
      expect(params.get("scope")).toBe("workers-scripts.admin workers-kv-storage.write account-settings.read user-details.read account-analytics.read offline_access");
    }
  });

  it("2.3b puts exactly the given redirect and scopes in the consent URL, without offline_access", async () => {
    const started = await startCloudflareAuthorization({ redirectUri: PAGE_REDIRECT, scopes: "user-details.read" });
    const params = new URL(started.url).searchParams;
    expect(params.get("redirect_uri")).toBe(PAGE_REDIRECT);
    expect(params.get("scope")).toBe("user-details.read");
    expect(started.url).not.toContain("offline_access");
    expect(params.get("client_id")).toBe(CLIENT_ID);
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toBe(createHash("sha256").update(started.verifier).digest("base64url"));
    expect(params.get("state")).toBe(started.state);
  });

  it("2.3b applies a redirect given alone while keeping the full scope list", async () => {
    const params = new URL((await startCloudflareAuthorization({ redirectUri: PAGE_REDIRECT })).url).searchParams;
    expect(params.get("redirect_uri")).toBe(PAGE_REDIRECT);
    expect(params.get("scope")).toContain("offline_access");
  });

  it("2.3b applies scopes given alone while keeping the loopback redirect", async () => {
    const params = new URL((await startCloudflareAuthorization({ scopes: "user-details.read" })).url).searchParams;
    expect(params.get("redirect_uri")).toBe(REDIRECT);
    expect(params.get("scope")).toBe("user-details.read");
  });

  it("2.3b keeps several given scopes space separated and encodes the space as %20", async () => {
    const started = await startCloudflareAuthorization({ scopes: "user-details.read account-settings.read" });
    expect(new URL(started.url).searchParams.get("scope")).toBe("user-details.read account-settings.read");
    expect(started.url).not.toContain("+");
  });
});

describe("fetchCloudflareTokens with options", () => {
  const request = (endpoint: ReturnType<typeof recordingTokenEndpoint>, extra: { redirectUri?: string; tokenUrl?: string } = {}) =>
    fetchCloudflareTokens({ code: "code-x", verifier: "verifier-x", fetch: endpoint.doFetch, logger: recordingLogger(), now: () => NOW, ...extra });

  it("2.3a posts to Cloudflare's token endpoint with the loopback redirect when given no options", async () => {
    const endpoint = recordingTokenEndpoint();
    await request(endpoint);
    expect(endpoint.seen).toHaveLength(1);
    expect(endpoint.seen[0]).toMatchObject({ url: "https://dash.cloudflare.com/oauth2/token", method: "POST" });
    expect(endpoint.seen[0]?.form.get("grant_type")).toBe("authorization_code");
    expect(endpoint.seen[0]?.form.get("client_id")).toBe(CLIENT_ID);
    expect(endpoint.seen[0]?.form.get("code")).toBe("code-x");
    expect(endpoint.seen[0]?.form.get("code_verifier")).toBe("verifier-x");
    expect(endpoint.seen[0]?.form.get("redirect_uri")).toBe(REDIRECT);
  });

  it("2.3b sends the given redirect in the token exchange", async () => {
    const endpoint = recordingTokenEndpoint();
    await request(endpoint, { redirectUri: PAGE_REDIRECT });
    expect(endpoint.seen[0]?.form.get("redirect_uri")).toBe(PAGE_REDIRECT);
    expect(endpoint.seen[0]?.url).toBe("https://dash.cloudflare.com/oauth2/token");
  });

  it("2.3b targets the given tokenUrl instead of Cloudflare's", async () => {
    const endpoint = recordingTokenEndpoint();
    const tokens = await request(endpoint, { redirectUri: PAGE_REDIRECT, tokenUrl: "https://labshelf.org/api/oauth/token" });
    expect(endpoint.seen).toHaveLength(1);
    expect(endpoint.seen[0]).toMatchObject({ url: "https://labshelf.org/api/oauth/token", method: "POST" });
    expect(endpoint.seen[0]?.form.get("redirect_uri")).toBe(PAGE_REDIRECT);
    expect(endpoint.seen[0]?.form.get("code")).toBe("code-x");
    expect(endpoint.seen[0]?.form.get("code_verifier")).toBe("verifier-x");
    expect(tokens).toEqual({ accessToken: "access-9", refreshToken: "refresh-9", expiresAt: NOW + 3600_000 });
  });

  it("2.3b sends the redirect the consent URL carried when a sign-in runs end to end", async () => {
    const endpoint = recordingTokenEndpoint();
    const server = fakeOAuthServer();
    const { url, state, verifier } = await startCloudflareAuthorization({ redirectUri: PAGE_REDIRECT, scopes: "user-details.read" });
    const callback = server.approve(url);
    expect(callback.startsWith(PAGE_REDIRECT)).toBe(true);
    const code = readAuthorizationCode(callback, state);
    await fetchCloudflareTokens({ code, verifier, redirectUri: PAGE_REDIRECT, tokenUrl: "https://labshelf.org/api/oauth/token", fetch: endpoint.doFetch, logger: recordingLogger(), now: () => NOW });
    expect(endpoint.seen[0]?.form.get("redirect_uri")).toBe(new URL(url).searchParams.get("redirect_uri"));
  });
});
