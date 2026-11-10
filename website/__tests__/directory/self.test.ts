// Pins POST /api/directory/self of documents/contracts/directory.md (D6): the caller's own relay URL, nothing else, on a fake D1 and a fake fetch.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { generateIdentity, publicKeys } from "@labshelf/core";

import { handleDirectoryRequest, type D1Database, type DirectoryDeps, type DirectoryEnv } from "../../src/directory/index";
import { self } from "../../src/directory/self";

const ORIGIN = "https://labshelf.org";
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 2, 10, 0, 0);
const SELF_PATH = "/api/directory/self";

type Sqlite = typeof import("node:sqlite");

/** A D1 stand-in over an in-memory SQLite that runs the shipped migration. */
function fakeD1(): D1Database {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as Sqlite;
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(__dirname, "../../migrations/0001_directory.sql"), "utf8"));
  type Arg = string | number | null;
  const statement = (sql: string, args: Arg[]) => ({
    bind: (...next: Arg[]) => statement(sql, next),
    first: async <T>() => (db.prepare(sql).get(...args) ?? null) as T | null,
    all: async <T>() => ({ results: db.prepare(sql).all(...args) as T[] }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql: string) => statement(sql, []) } as D1Database;
}

interface World {
  env: DirectoryEnv;
  deps: DirectoryDeps;
  emails: Map<string, string | null>;
  now: number;
  fetched: string[];
}

async function world(): Promise<World> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
  const w: World = {
    env: { DB: fakeD1(), DIRECTORY_SECRET: "directory-secret-for-tests", DIRECTORY_SIGNING_KEY: pkcs8 },
    deps: undefined as unknown as DirectoryDeps,
    emails: new Map(),
    now: T0,
    fetched: [],
  };
  w.deps = {
    now: () => w.now,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      w.fetched.push(request.url);
      if (request.url === "https://api.cloudflare.com/client/v4/user") {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
        if (!w.emails.has(token)) { return Response.json({ success: false, errors: [{ code: 9109, message: "Unauthorized" }] }, { status: 403 }); }
        const email = w.emails.get(token);
        return Response.json({ success: true, result: email === null ? { id: "u" } : { id: "u", email } });
      }
      throw new Error(`unexpected fetch ${request.url}`);
    },
  };
  return w;
}

interface User { token: string; email: string; inboxUrl: string; inboxToken: string; encryptionKey: string; signingKey: string }

async function user(w: World, name: string): Promise<User> {
  const keys = await publicKeys(await generateIdentity());
  const u = { token: `cf-access-${name}`, email: `${name}@Example.org`, inboxUrl: `https://ls-${name}.acct.workers.dev`, inboxToken: `inbox-token-${name}`, ...keys };
  w.emails.set(u.token, u.email);
  return u;
}

async function register(w: World, u: User): Promise<void> {
  const request = new Request(`${ORIGIN}/api/directory/register`, {
    method: "POST",
    headers: { authorization: `Bearer ${u.token}`, "content-type": "application/json" },
    body: JSON.stringify({ inboxUrl: u.inboxUrl, inboxToken: u.inboxToken, encryptionKey: u.encryptionKey, signingKey: u.signingKey }),
  });
  const response = await handleDirectoryRequest(request, w.env, w.deps);
  expect(response.status).toBe(200);
}

async function askSelf(w: World, token: string | undefined): Promise<{ status: number; text: string; json: Record<string, unknown>; headers: Headers }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) { headers.authorization = `Bearer ${token}`; }
  const response = await self(new Request(`${ORIGIN}${SELF_PATH}`, { method: "POST", headers, body: "" }), w.env, w.deps, w.now);
  const text = await response.text();
  return { status: response.status, text, json: text ? JSON.parse(text) as Record<string, unknown> : {}, headers: response.headers };
}

/** Calls self until the caller is rate limited (at most 300 times); returns how many calls it took, or -1. */
async function exhaust(w: World, token: string): Promise<number> {
  for (let i = 1; i <= 300; i += 1) {
    if ((await askSelf(w, token)).status === 429) { return i; }
  }
  return -1;
}

describe("directory self (2.2a)", () => {
  it("2.2a answers the caller's own relay URL for a valid token", async () => {
    const w = await world();
    const a = await user(w, "alice");
    await register(w, a);
    const response = await askSelf(w, a.token);
    expect(response.status).toBe(200);
    expect(response.json).toEqual({ relayUrl: a.inboxUrl });
  });

  it("2.2a never puts inboxToken, encryptionKey, signingKey or the email in the body", async () => {
    const w = await world();
    const a = await user(w, "alice");
    await register(w, a);
    const response = await askSelf(w, a.token);
    const text = response.text.toLowerCase();
    expect(text).not.toContain(a.inboxToken.toLowerCase());
    expect(text).not.toContain(a.encryptionKey.toLowerCase());
    expect(text).not.toContain(a.signingKey.toLowerCase());
    expect(text).not.toContain("inboxtoken");
    expect(text).not.toContain("alice@example.org");
  });

  it("2.2a answers each caller only their own row", async () => {
    const w = await world();
    const a = await user(w, "alice");
    const b = await user(w, "bob");
    await register(w, a);
    await register(w, b);
    expect((await askSelf(w, a.token)).json).toEqual({ relayUrl: a.inboxUrl });
    expect((await askSelf(w, b.token)).json).toEqual({ relayUrl: b.inboxUrl });
  });

  it("2.2a answers through POST /api/directory/self with the CORS origin header", async () => {
    const w = await world();
    const a = await user(w, "alice");
    await register(w, a);
    const request = new Request(`${ORIGIN}${SELF_PATH}`, { method: "POST", headers: { authorization: `Bearer ${a.token}` }, body: "" });
    const response = await handleDirectoryRequest(request, w.env, w.deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ relayUrl: a.inboxUrl });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("directory self refusals and limits (2.2b)", () => {
  it("2.2b answers unauthorized for a refused token", async () => {
    const w = await world();
    const response = await askSelf(w, "cf-access-unknown");
    expect(response.status).toBe(401);
    expect(response.json).toEqual({ error: "unauthorized" });
  });

  it("2.2b answers unauthorized without a bearer token", async () => {
    const w = await world();
    const response = await askSelf(w, undefined);
    expect(response.status).toBe(401);
    expect(response.json).toEqual({ error: "unauthorized" });
  });

  it("2.2b answers not_found for a valid token whose email is not registered", async () => {
    const w = await world();
    const a = await user(w, "alice");
    const response = await askSelf(w, a.token);
    expect(response.status).toBe(404);
    expect(response.json).toEqual({ error: "not_found" });
  });

  it("2.2b answers rate_limited once the caller passes its limit", async () => {
    const w = await world();
    const a = await user(w, "alice");
    await register(w, a);
    const limitedAt = await exhaust(w, a.token);
    expect(limitedAt).toBeGreaterThan(1);
    const response = await askSelf(w, a.token);
    expect(response.status).toBe(429);
    expect(response.json).toEqual({ error: "rate_limited" });
  });

  it("2.2b limits one caller without limiting another", async () => {
    const w = await world();
    const a = await user(w, "alice");
    const b = await user(w, "bob");
    await register(w, a);
    await register(w, b);
    expect(await exhaust(w, a.token)).toBeGreaterThan(1);
    expect((await askSelf(w, a.token)).status).toBe(429);
    expect((await askSelf(w, b.token)).status).toBe(200);
  });

  it("2.2b keeps its counter apart from lookup", async () => {
    const w = await world();
    const a = await user(w, "alice");
    const b = await user(w, "bob");
    await register(w, a);
    await register(w, b);
    expect(await exhaust(w, a.token)).toBeGreaterThan(1);
    const lookup = await handleDirectoryRequest(
      new Request(`${ORIGIN}/api/directory/lookup`, {
        method: "POST", headers: { authorization: `Bearer ${a.token}`, "content-type": "application/json" }, body: JSON.stringify({ email: b.email }),
      }),
      w.env, w.deps,
    );
    expect(lookup.status).toBe(200);
  });

  it("2.2b answers again a day after the caller was limited", async () => {
    const w = await world();
    const a = await user(w, "alice");
    await register(w, a);
    expect(await exhaust(w, a.token)).toBeGreaterThan(1);
    w.now += 25 * HOUR;
    expect((await askSelf(w, a.token)).status).toBe(200);
  });
});

describe("directory self preflight (2.2d)", () => {
  it("2.2d answers the CORS preflight on /api/directory/self", async () => {
    const w = await world();
    const response = await handleDirectoryRequest(
      new Request(`${ORIGIN}${SELF_PATH}`, { method: "OPTIONS", headers: { origin: ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "authorization" } }),
      w.env, w.deps,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-methods")).toContain("OPTIONS");
    expect((response.headers.get("access-control-allow-headers") ?? "").toLowerCase()).toContain("authorization");
    expect(w.fetched).toEqual([]);
  });
});
