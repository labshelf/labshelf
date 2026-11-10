// Pins the /open/ sign-in: Authorization Code + PKCE against Cloudflare, with verifier and state in sessionStorage only for the redirect.
import { createHash } from "node:crypto";

import { beginSignIn, finishSignIn } from "../../src/open/signIn";

const REDIRECT = "https://labshelf.org/open/";
const ACCESS_TOKEN = "cf-access-token-0123456789";

/** An in-memory Storage that remembers every value ever written, so "never written" can be asserted. */
class FakeStorage {
  private map = new Map<string, string>();
  readonly written: string[] = [];
  get length(): number { return this.map.size; }
  key(index: number): string | null { return [...this.map.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.written.push(`${key}=${value}`); this.map.set(key, String(value)); }
  removeItem(key: string): void { this.map.delete(key); }
  clear(): void { this.map.clear(); }
  entries(): [string, string][] { return [...this.map.entries()]; }
}

/** A Location that records where the page was sent, whichever way the code navigates. */
class FakeLocation {
  readonly navigations: string[] = [];
  private current: URL;
  constructor(href: string) { this.current = new URL(href); }
  get href(): string { return this.current.href; }
  set href(value: string) { this.navigations.push(value); }
  get origin(): string { return this.current.origin; }
  get pathname(): string { return this.current.pathname; }
  get search(): string { return this.current.search; }
  get hash(): string { return this.current.hash; }
  assign(url: string | URL): void { this.navigations.push(String(url)); }
  replace(url: string | URL): void { this.navigations.push(String(url)); }
}

const asStorage = (storage: FakeStorage) => storage as unknown as Storage;
const asLocation = (location: FakeLocation) => location as unknown as Location;

const sha256Base64Url = (text: string) => createHash("sha256").update(text).digest("base64url");

interface Started { storage: FakeStorage; consent: URL; state: string; verifier: string }

async function startSignIn(): Promise<Started> {
  const storage = new FakeStorage();
  const location = new FakeLocation(REDIRECT);
  await beginSignIn({ storage: asStorage(storage), location: asLocation(location) });
  expect(location.navigations).toHaveLength(1);
  const consent = new URL(location.navigations[0]!);
  const state = consent.searchParams.get("state") ?? "";
  const challenge = consent.searchParams.get("code_challenge") ?? "";
  const verifier = storage.entries().map(([, value]) => value).find((value) => sha256Base64Url(value) === challenge) ?? "";
  return { storage, consent, state, verifier };
}

interface TokenCall { url: URL; params: URLSearchParams }

const okAnswer = () => new Response(JSON.stringify({ access_token: ACCESS_TOKEN, token_type: "bearer", expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } });

/** A fetch that answers only the website's token proxy and records what reached it; any other request fails. */
function tokenFetch(answer: () => Response = okAnswer) {
  const calls: TokenCall[] = [];
  const unexpected: string[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, REDIRECT);
    if (url.origin === "https://labshelf.org" && url.pathname === "/api/oauth/token") {
      const raw = String(init?.body ?? "");
      let params: URLSearchParams;
      try {
        params = new URLSearchParams(Object.entries(JSON.parse(raw) as Record<string, string>));
      } catch {
        params = new URLSearchParams(raw);
      }
      calls.push({ url, params });
      return answer();
    }
    unexpected.push(url.href);
    throw new Error(`unexpected request to ${url.href}`);
  }) as typeof fetch;
  return { fetch: fakeFetch, calls, unexpected };
}

const returnTo = (code: string, state: string) => new FakeLocation(`${REDIRECT}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);

/** The outcome of a call that may either reject or resolve to nothing: what matters is that no token comes out. */
async function outcomeOf(run: Promise<string | undefined>): Promise<{ token: string | undefined; threw: boolean }> {
  try {
    return { token: await run, threw: false };
  } catch {
    return { token: undefined, threw: true };
  }
}

describe("beginSignIn", () => {
  it("5.1a sends the page to Cloudflare's consent URL for the https://labshelf.org/open/ redirect", async () => {
    const { consent } = await startSignIn();
    expect(consent.origin).toBe("https://dash.cloudflare.com");
    expect(consent.searchParams.get("response_type")).toBe("code");
    expect(consent.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(consent.searchParams.get("client_id")).toBe("6bf60d8231e753c5249c7044aa0c4aff");
  });

  it("5.1a asks for the user-details.read scope only, with no offline_access", async () => {
    const { consent } = await startSignIn();
    expect(consent.searchParams.get("scope")).toBe("user-details.read");
    expect(consent.href).not.toContain("offline_access");
  });

  it("5.1a stores the PKCE verifier in sessionStorage and sends its S256 challenge", async () => {
    const { consent, verifier, storage } = await startSignIn();
    expect(consent.searchParams.get("code_challenge_method")).toBe("S256");
    expect(verifier).not.toBe("");
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(storage.entries().some(([, value]) => value === verifier)).toBe(true);
  });

  it("5.1a stores the state it sent in sessionStorage", async () => {
    const { storage, state } = await startSignIn();
    expect(state).not.toBe("");
    expect(storage.entries().some(([, value]) => value === state)).toBe(true);
  });

  it("5.1a uses a fresh verifier and state for every sign-in", async () => {
    const first = await startSignIn();
    const second = await startSignIn();
    expect(second.state).not.toBe(first.state);
    expect(second.verifier).not.toBe(first.verifier);
  });
});

describe("finishSignIn", () => {
  it("5.1b exchanges the code through the website's /api/oauth/token proxy and returns the access token", async () => {
    const { storage, state, verifier } = await startSignIn();
    const server = tokenFetch();
    const token = await finishSignIn({ storage: asStorage(storage), location: asLocation(returnTo("the-code", state)), fetch: server.fetch });
    expect(token).toBe(ACCESS_TOKEN);
    expect(server.calls).toHaveLength(1);
    const { params } = server.calls[0]!;
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("the-code");
    expect(params.get("code_verifier")).toBe(verifier);
    expect(params.get("redirect_uri")).toBe(REDIRECT);
    expect(server.unexpected).toEqual([]);
  });

  it("5.1b accepts a token answer with no refresh token", async () => {
    const { storage, state } = await startSignIn();
    const server = tokenFetch(() => new Response(JSON.stringify({ access_token: ACCESS_TOKEN, expires_in: 3600 }), { status: 200 }));
    await expect(finishSignIn({ storage: asStorage(storage), location: asLocation(returnTo("c", state)), fetch: server.fetch })).resolves.toBe(ACCESS_TOKEN);
  });

  it("5.1b deletes the verifier and the state from sessionStorage once the code is exchanged", async () => {
    const { storage, state, verifier } = await startSignIn();
    const server = tokenFetch();
    await finishSignIn({ storage: asStorage(storage), location: asLocation(returnTo("c", state)), fetch: server.fetch });
    const left = storage.entries().map(([, value]) => value);
    expect(left).not.toContain(verifier);
    expect(left).not.toContain(state);
    expect(storage.length).toBe(0);
  });

  it("5.1b refuses a return whose state is not the one that was sent, and never calls the token endpoint", async () => {
    const { storage } = await startSignIn();
    const server = tokenFetch();
    const result = await outcomeOf(finishSignIn({ storage: asStorage(storage), location: asLocation(returnTo("forged-code", "not-the-state")), fetch: server.fetch }));
    expect(result.token).toBeUndefined();
    expect(server.calls).toEqual([]);
    expect(server.unexpected).toEqual([]);
  });

  it("5.1b refuses a return when no sign-in was begun in this tab", async () => {
    const storage = new FakeStorage();
    const server = tokenFetch();
    const result = await outcomeOf(finishSignIn({ storage: asStorage(storage), location: asLocation(returnTo("c", "some-state")), fetch: server.fetch }));
    expect(result.token).toBeUndefined();
    expect(server.calls).toEqual([]);
  });

  it("5.1b writes the access token to no storage", async () => {
    const { storage, state } = await startSignIn();
    const server = tokenFetch();
    await finishSignIn({ storage: asStorage(storage), location: asLocation(returnTo("c", state)), fetch: server.fetch });
    expect(storage.written.some((entry) => entry.includes(ACCESS_TOKEN))).toBe(false);
    expect(storage.entries().some(([key, value]) => key.includes(ACCESS_TOKEN) || value.includes(ACCESS_TOKEN))).toBe(false);
  });

  it("5.1b reaches only the website's proxy, never Cloudflare's token endpoint directly", async () => {
    const { storage, state } = await startSignIn();
    const server = tokenFetch();
    await finishSignIn({ storage: asStorage(storage), location: asLocation(returnTo("c", state)), fetch: server.fetch });
    expect(server.calls.map((call) => call.url.origin + call.url.pathname)).toEqual(["https://labshelf.org/api/oauth/token"]);
    expect(server.unexpected).toEqual([]);
  });
});
