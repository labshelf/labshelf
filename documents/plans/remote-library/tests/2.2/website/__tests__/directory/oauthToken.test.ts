// Pins POST /api/oauth/token of documents/contracts/directory.md (D7): a code-exchange proxy for the registered client and redirect only.
import { handleDirectoryRequest, type D1Database, type DirectoryDeps, type DirectoryEnv } from "../../src/directory/index";
import { proxyOauthToken } from "../../src/directory/oauthToken";

const ORIGIN = "https://labshelf.org";
const TOKEN_PATH = "/api/oauth/token";
const CLIENT_ID = "6bf60d8231e753c5249c7044aa0c4aff";
const REDIRECT = "https://labshelf.org/open/";
const TOKEN_URL = "https://dash.cloudflare.com/oauth2/token";

interface Upstream { url: string; method: string; contentType: string | null; form: URLSearchParams }

interface World {
  deps: DirectoryDeps;
  upstream: Upstream[];
  answer: () => Response;
}

function world(): World {
  const w: World = {
    upstream: [],
    answer: () => Response.json({ access_token: "access-1", token_type: "bearer", expires_in: 3600, scope: "user-details.read" }),
    deps: undefined as unknown as DirectoryDeps,
  };
  w.deps = {
    now: () => Date.UTC(2026, 10, 2, 10, 0, 0),
    fetch: async (input, init) => {
      const request = new Request(input, init);
      w.upstream.push({ url: request.url, method: request.method, contentType: request.headers.get("content-type"), form: new URLSearchParams(await request.text()) });
      return w.answer();
    },
  };
  return w;
}

const GOOD = { grant_type: "authorization_code", client_id: CLIENT_ID, redirect_uri: REDIRECT, code: "code-123", code_verifier: "verifier-abc" };

function exchange(fields: Record<string, string>): Request {
  return new Request(`${ORIGIN}${TOKEN_PATH}`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString(),
  });
}

function without(fields: Record<string, string>, name: string): Record<string, string> {
  const copy = { ...fields };
  delete copy[name];
  return copy;
}

describe("oauth token proxy forwards the code exchange (2.2c)", () => {
  it("2.2c forwards the form to the Cloudflare token endpoint", async () => {
    const w = world();
    await proxyOauthToken(exchange(GOOD), w.deps);
    expect(w.upstream).toHaveLength(1);
    expect(w.upstream[0].url).toBe(TOKEN_URL);
    expect(w.upstream[0].method).toBe("POST");
    expect(w.upstream[0].contentType).toContain("application/x-www-form-urlencoded");
    expect(Object.fromEntries(w.upstream[0].form)).toMatchObject(GOOD);
  });

  it("2.2c returns the token endpoint's status and JSON", async () => {
    const w = world();
    const response = await proxyOauthToken(exchange(GOOD), w.deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ access_token: "access-1", token_type: "bearer", expires_in: 3600, scope: "user-details.read" });
  });

  it("2.2c returns the token endpoint's refusal status and JSON unchanged", async () => {
    const w = world();
    w.answer = () => Response.json({ error: "invalid_grant", error_description: "code expired" }, { status: 400 });
    const response = await proxyOauthToken(exchange(GOOD), w.deps);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_grant", error_description: "code expired" });
  });

  it("2.2c answers with a JSON content type and the CORS origin header", async () => {
    const w = world();
    const response = await proxyOauthToken(exchange(GOOD), w.deps);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("2.2c logs nothing", async () => {
    const w = world();
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((name) => jest.spyOn(console, name).mockImplementation(() => undefined));
    try {
      await proxyOauthToken(exchange(GOOD), w.deps);
      w.answer = () => Response.json({ error: "invalid_grant" }, { status: 400 });
      await proxyOauthToken(exchange(GOOD), w.deps);
      await proxyOauthToken(exchange({ ...GOOD, grant_type: "refresh_token" }), w.deps);
      for (const spy of spies) { expect(spy).not.toHaveBeenCalled(); }
    } finally {
      for (const spy of spies) { spy.mockRestore(); }
    }
  });
});

describe("oauth token proxy refuses everything else (2.2c)", () => {
  const refused: [string, Record<string, string>][] = [
    ["a refresh_token grant", { ...GOOD, grant_type: "refresh_token", refresh_token: "r-1" }],
    ["a client_credentials grant", { ...GOOD, grant_type: "client_credentials" }],
    ["a missing grant_type", without(GOOD, "grant_type")],
    ["another client id", { ...GOOD, client_id: "0123456789abcdef0123456789abcdef" }],
    ["another redirect", { ...GOOD, redirect_uri: "https://evil.example/open/" }],
    ["the loopback redirect", { ...GOOD, redirect_uri: "http://127.0.0.1:8976/callback" }],
    ["a missing redirect", without(GOOD, "redirect_uri")],
  ];

  it.each(refused)("2.2c refuses %s without calling Cloudflare", async (_name, fields) => {
    const w = world();
    const response = await proxyOauthToken(exchange(fields), w.deps);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(w.upstream).toEqual([]);
  });
});

describe("oauth token proxy route (2.2c, 2.2d)", () => {
  /** A D1 that accepts any usage charge, so the route's accounting cannot decide the test. */
  const env: DirectoryEnv = {
    DB: {
      prepare: () => { const s = { bind: () => s, first: async () => ({ requests: 2 }), run: async () => ({}) }; return s; },
    } as unknown as D1Database,
    DIRECTORY_SECRET: "directory-secret-for-tests",
    DIRECTORY_SIGNING_KEY: "unused",
  };

  it("2.2c answers a code exchange through POST /api/oauth/token", async () => {
    const w = world();
    const response = await handleDirectoryRequest(exchange(GOOD), env, w.deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ access_token: "access-1" });
    expect(w.upstream.map((call) => call.url)).toEqual([TOKEN_URL]);
  });

  it("2.2d answers the CORS preflight on /api/oauth/token", async () => {
    const w = world();
    const response = await handleDirectoryRequest(
      new Request(`${ORIGIN}${TOKEN_PATH}`, { method: "OPTIONS", headers: { origin: ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } }),
      env, w.deps,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-methods")).toContain("OPTIONS");
    expect((response.headers.get("access-control-allow-headers") ?? "").toLowerCase()).toContain("content-type");
    expect(w.upstream).toEqual([]);
  });
});
