/** Pins the relay's /mirror/* routes: owner-secret writes, the Cloudflare-token session exchange, session-token reads, the 1 MiB rows limit,
 * the session rate limit, and the deploy binding and protocol minor that carry the Mirror to deployed Workers. */
import { DatabaseSync } from "node:sqlite";
import {
  deployRelay, RELAY_MIGRATIONS, RELAY_PROTOCOL_MINOR, RELAY_PROTOCOL_VERSION, RELAY_WORKER_BUILD,
} from "../../../src/relay/index";
import worker, { Mirror, type RelayEnv } from "../../../src/relay/worker/index";
import { answerMirrorRequest } from "../../../src/relay/worker/mirrorRoutes";
import { ACCOUNT, TOKEN, fakeCloudflare, metadataOf, recordingLogger } from "../fakeCloudflare";
import { fakeEnv, fakeSql, OWNER_SECRET } from "./fakeRoomRuntime";

const BASE = "https://relay.example.workers.dev";
const HOUR = 3600 * 1000;
const T0 = Date.UTC(2026, 10, 9, 12, 0, 0);
const OWNER_EMAIL = "owner@example.com";
const OWNER_TOKEN = "cf-token-of-the-owner-SECRET-0123456789";
const OTHER_TOKEN = "cf-token-of-someone-else-SECRET-9876543210";
const HASH = "a".repeat(64);
const ownerAuth = { Authorization: `Bearer ${OWNER_SECRET}` };

/** A Cloudflare `/user` stand-in: each known token answers its account email, every other token is refused. */
function fakeUserApi(users: Record<string, string>) {
  const calls: { url: string; method: string; authorization: string | null }[] = [];
  const fetchFake = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input as string | Request, init);
    const authorization = request.headers.get("authorization");
    calls.push({ url: request.url, method: request.method, authorization });
    const email = users[(authorization ?? "").replace(/^Bearer /, "")];
    return email === undefined
      ? new Response(JSON.stringify({ success: false, errors: [{ code: 1000, message: "Invalid API Token" }], result: null }), { status: 401 })
      : new Response(JSON.stringify({ success: true, errors: [], result: { id: "u1", email } }), { status: 200 });
  }) as typeof fetch;
  return { fetch: fetchFake, calls };
}

/** The relay env with a real Mirror on in-memory SQLite behind MIRROR; `db` lets a test look at everything the Mirror keeps. */
function mirrorSetup(users: Record<string, string> = { [OWNER_TOKEN]: OWNER_EMAIL, [OTHER_TOKEN]: "someone@else.org" }) {
  const db = new DatabaseSync(":memory:");
  const mirror = new Mirror({ storage: { sql: fakeSql(db) }, blockConcurrencyWhile: async (run: () => unknown) => run() } as never);
  const env = {
    ...fakeEnv().env,
    MIRROR: { idFromName: (name: string) => name, get: () => ({ fetch: (request: Request) => mirror.fetch(request) }) },
  } as unknown as RelayEnv;
  const clock = { time: T0 };
  const userApi = fakeUserApi(users);
  const deps = { fetch: userApi.fetch, now: () => clock.time };
  return { db, env, clock, deps, userApi };
}

type Setup = ReturnType<typeof mirrorSetup>;

async function send(
  setup: Setup, method: string, path: string, options: { body?: unknown; headers?: Record<string, string>; env?: RelayEnv } = {},
): Promise<Response> {
  const body = options.body === undefined ? undefined : typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  const request = new Request(`${BASE}${path}`, { method, headers: options.headers ?? {}, ...(body === undefined ? {} : { body }) });
  const response = await answerMirrorRequest(request, options.env ?? setup.env, setup.deps);
  if (!response) { throw new Error(`answerMirrorRequest did not answer ${method} ${path}`); }
  return response;
}

const jsonOf = async (response: Response): Promise<Record<string, unknown>> => (await response.json()) as Record<string, unknown>;

async function setOwner(setup: Setup, email = OWNER_EMAIL): Promise<void> {
  expect((await send(setup, "PUT", "/mirror/owner", { body: { email }, headers: ownerAuth })).status).toBe(200);
}

async function openSession(setup: Setup, token = OWNER_TOKEN): Promise<string> {
  const response = await send(setup, "POST", "/mirror/session", { body: { accessToken: token } });
  expect(response.status).toBe(200);
  const { session } = await jsonOf(response);
  expect(typeof session).toBe("string");
  return session as string;
}

const bearer = (session: string) => ({ Authorization: `Bearer ${session}` });

const row = (path: string, value: string, kind = "notes") => ({ path, kind, hash: HASH, size: value.length, value });

const putRows = (setup: Setup, rows: ReturnType<typeof row>[], headers: Record<string, string> = ownerAuth) =>
  send(setup, "POST", "/mirror/rows", { body: { put: rows, delete: [] }, headers });

/** Every string under a `path` key anywhere in the answer, whatever envelope the listing comes in. */
function pathsIn(value: unknown): string[] {
  if (Array.isArray(value)) { return value.flatMap(pathsIn); }
  if (typeof value !== "object" || value === null) { return []; }
  return Object.entries(value).flatMap(([key, item]) => (key === "path" && typeof item === "string" ? [item] : pathsIn(item)));
}

async function indexedPaths(setup: Setup, session: string): Promise<string[]> {
  const response = await send(setup, "GET", "/mirror/index", { headers: bearer(session) });
  expect(response.status).toBe(200);
  return pathsIn(await response.json());
}

const flipMiddle = (text: string): string => {
  const at = Math.floor(text.length / 2);
  return `${text.slice(0, at)}${text[at] === "A" ? "B" : "A"}${text.slice(at + 1)}`;
};

describe("1.3a owner-secret writes", () => {
  const writes: [string, string, unknown][] = [
    ["PUT", "/mirror/owner", { email: OWNER_EMAIL }],
    ["POST", "/mirror/lease", { deviceId: "laptop", action: "acquire" }],
    ["POST", "/mirror/rows", { put: [row("papers/a/notes.qmd", "hello")], delete: [] }],
    ["DELETE", "/mirror/rows", undefined],
  ];

  it.each(writes)("1.3a refuses %s %s without the owner secret", async (method, path, body) => {
    const setup = mirrorSetup();
    const response = await send(setup, method, path, { body });
    expect(response.status).toBe(401);
    expect(await jsonOf(response)).toMatchObject({ error: "unauthorized" });
  });

  it.each(writes)("1.3a refuses %s %s with a wrong owner secret", async (method, path, body) => {
    const setup = mirrorSetup();
    const response = await send(setup, method, path, { body, headers: { Authorization: "Bearer not-the-secret" } });
    expect(response.status).toBe(401);
    expect(await jsonOf(response)).toMatchObject({ error: "unauthorized" });
  });

  it("1.3a refuses a write on a Worker with no OWNER_SECRET even when a bearer is sent", async () => {
    const setup = mirrorSetup();
    const { OWNER_SECRET: _dropped, ...rest } = setup.env;
    const response = await send(setup, "PUT", "/mirror/owner", {
      body: { email: OWNER_EMAIL }, headers: { Authorization: "Bearer anything" }, env: rest as RelayEnv,
    });
    expect(response.status).toBe(401);
  });

  it("1.3a leaves the Mirror untouched by a refused owner write", async () => {
    const setup = mirrorSetup();
    await send(setup, "PUT", "/mirror/owner", { body: { email: OWNER_EMAIL } });
    const response = await send(setup, "POST", "/mirror/session", { body: { accessToken: OWNER_TOKEN } });
    expect(await jsonOf(response)).toMatchObject({ error: "off" });
  });

  it("1.3a leaves the Mirror untouched by a refused rows write", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    await send(setup, "POST", "/mirror/rows", { body: { put: [row("papers/a/notes.qmd", "hello")], delete: [] } });
    expect(await indexedPaths(setup, await openSession(setup))).toEqual([]);
  });

  it("1.3a lets PUT /mirror/owner with the owner secret reach the Mirror", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    expect((await send(setup, "POST", "/mirror/session", { body: { accessToken: OWNER_TOKEN } })).status).toBe(200);
  });

  it("1.3a lets POST /mirror/lease with the owner secret reach the Mirror and answers held", async () => {
    const setup = mirrorSetup();
    const first = await send(setup, "POST", "/mirror/lease", { body: { deviceId: "laptop", action: "acquire" }, headers: ownerAuth });
    expect(first.status).toBe(200);
    expect(await jsonOf(first)).toMatchObject({ held: true });
    const second = await send(setup, "POST", "/mirror/lease", { body: { deviceId: "desktop", action: "acquire" }, headers: ownerAuth });
    expect(await jsonOf(second)).toMatchObject({ held: false });
  });

  it("1.3a lets POST /mirror/rows with the owner secret reach the Mirror", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    const response = await putRows(setup, [row("papers/a/notes.qmd", "hello"), row("index/papers.json", "{}", "papers")]);
    expect(response.status).toBe(200);
    expect((await indexedPaths(setup, await openSession(setup))).sort()).toEqual(["index/papers.json", "papers/a/notes.qmd"]);
  });

  it("1.3a lets DELETE /mirror/rows with the owner secret clear the rows and the owner email", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    await putRows(setup, [row("papers/a/notes.qmd", "hello")]);
    const cleared = await send(setup, "DELETE", "/mirror/rows", { headers: ownerAuth });
    expect(cleared.status).toBe(200);
    const after = await send(setup, "POST", "/mirror/session", { body: { accessToken: OWNER_TOKEN } });
    expect(await jsonOf(after)).toMatchObject({ error: "off" });
  });

  it("1.3a refuses a session token presented as the owner secret on a write", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    const session = await openSession(setup);
    const response = await putRows(setup, [row("papers/a/notes.qmd", "hello")], bearer(session));
    expect(response.status).toBe(401);
    expect(await indexedPaths(setup, session)).toEqual([]);
  });

  it("1.3a returns undefined for a path outside /mirror so the relay's other routes keep answering", async () => {
    const setup = mirrorSetup();
    for (const path of ["/version", "/claim", "/inbox", "/project/abc", "/share/abc/manifest"]) {
      expect(await answerMirrorRequest(new Request(`${BASE}${path}`), setup.env, setup.deps)).toBeUndefined();
    }
  });

  it("1.3a routes /mirror/* from the relay Worker's own handler", async () => {
    const setup = mirrorSetup();
    const put = (headers: Record<string, string>) =>
      worker.fetch(new Request(`${BASE}/mirror/owner`, { method: "PUT", headers, body: JSON.stringify({ email: OWNER_EMAIL }) }), setup.env);
    expect((await put({})).status).toBe(401);
    expect((await put(ownerAuth)).status).toBe(200);
  });
});

describe("1.3b POST /mirror/session", () => {
  it("1.3b answers a session and its expiry for the owner's account", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    const response = await send(setup, "POST", "/mirror/session", { body: { accessToken: OWNER_TOKEN } });
    expect(response.status).toBe(200);
    const body = await jsonOf(response);
    expect(typeof body.session).toBe("string");
    expect((body.session as string).length).toBeGreaterThan(0);
    expect(typeof body.expires).toBe("number");
    expect(body.error).toBeUndefined();
  });

  it("1.3b compares the email case-insensitively when Cloudflare reports other case than the stored one", async () => {
    const setup = mirrorSetup({ [OWNER_TOKEN]: "OWNER@Example.COM" });
    await setOwner(setup, "owner@example.com");
    expect(await openSession(setup)).toBeTruthy();
  });

  it("1.3b compares the email case-insensitively when the stored one has capitals", async () => {
    const setup = mirrorSetup({ [OWNER_TOKEN]: "owner@example.com" });
    await setOwner(setup, "Owner@Example.com");
    expect(await openSession(setup)).toBeTruthy();
  });

  it("1.3b answers off when no owner email is stored", async () => {
    const setup = mirrorSetup();
    const response = await send(setup, "POST", "/mirror/session", { body: { accessToken: OWNER_TOKEN } });
    expect(await jsonOf(response)).toMatchObject({ error: "off" });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("1.3b answers off again after the library is cleared", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    await openSession(setup);
    await send(setup, "DELETE", "/mirror/rows", { headers: ownerAuth });
    const response = await send(setup, "POST", "/mirror/session", { body: { accessToken: OWNER_TOKEN } });
    expect(await jsonOf(response)).toMatchObject({ error: "off" });
  });

  it("1.3b answers other_account for a valid token of a different email", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    const response = await send(setup, "POST", "/mirror/session", { body: { accessToken: OTHER_TOKEN } });
    const body = await jsonOf(response);
    expect(body).toMatchObject({ error: "other_account" });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(body).not.toHaveProperty("session");
  });

  it("1.3b answers unauthorized for a token Cloudflare refuses", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    const response = await send(setup, "POST", "/mirror/session", { body: { accessToken: "revoked-token" } });
    expect(response.status).toBe(401);
    expect(await jsonOf(response)).toMatchObject({ error: "unauthorized" });
  });

  it("1.3b asks Cloudflare once, with GET /client/v4/user and the token as bearer", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    await openSession(setup);
    expect(setup.userApi.calls).toEqual([
      { url: "https://api.cloudflare.com/client/v4/user", method: "GET", authorization: `Bearer ${OWNER_TOKEN}` },
    ]);
  });

  it("1.3b never stores the token in the Mirror, answers it, or logs it", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => jest.spyOn(console, level).mockImplementation(() => undefined));
    try {
      const setup = mirrorSetup();
      await setOwner(setup);
      const answers = [
        await send(setup, "POST", "/mirror/session", { body: { accessToken: OWNER_TOKEN } }),
        await send(setup, "POST", "/mirror/session", { body: { accessToken: OTHER_TOKEN } }),
        await send(setup, "POST", "/mirror/session", { body: { accessToken: "revoked-SECRET-token" } }),
      ];
      const texts = await Promise.all(answers.map((answer) => answer.text()));
      const tables = setup.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
      const stored = tables.map(({ name }) => JSON.stringify(setup.db.prepare(`SELECT * FROM "${name}"`).all())).join("\n");
      const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
      for (const secret of [OWNER_TOKEN, OTHER_TOKEN, "revoked-SECRET-token"]) {
        expect(stored).not.toContain(secret);
        expect(logged).not.toContain(secret);
        expect(texts.join("\n")).not.toContain(secret);
      }
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
});

describe("1.3c session-token reads", () => {
  async function filled() {
    const setup = mirrorSetup();
    await setOwner(setup);
    await putRows(setup, [row("papers/a/notes.qmd", "my notes"), row("projects/p/main.typ", "= Title", "source")]);
    return { setup, session: await openSession(setup) };
  }

  it("1.3c refuses GET /mirror/index without a session", async () => {
    const { setup } = await filled();
    const response = await send(setup, "GET", "/mirror/index");
    expect(response.status).toBe(401);
    expect(await jsonOf(response)).toMatchObject({ error: "unauthorized" });
  });

  it("1.3c refuses GET /mirror/file/<path> without a session", async () => {
    const { setup } = await filled();
    const response = await send(setup, "GET", "/mirror/file/papers/a/notes.qmd");
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("my notes");
  });

  it("1.3c lists the rows on GET /mirror/index with a valid session", async () => {
    const { setup, session } = await filled();
    expect((await indexedPaths(setup, session)).sort()).toEqual(["papers/a/notes.qmd", "projects/p/main.typ"]);
  });

  it("1.3c returns a row's value on GET /mirror/file/<path> with a valid session", async () => {
    const { setup, session } = await filled();
    const response = await send(setup, "GET", "/mirror/file/papers/a/notes.qmd", { headers: bearer(session) });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("my notes");
  });

  it("1.3c refuses the owner secret in place of a session on a read", async () => {
    const { setup } = await filled();
    expect((await send(setup, "GET", "/mirror/index", { headers: ownerAuth })).status).toBe(401);
  });

  it("1.3c accepts the session until it expires and refuses it after", async () => {
    const { setup, session } = await filled();
    setup.clock.time = T0 + 3 * HOUR;
    expect((await send(setup, "GET", "/mirror/index", { headers: bearer(session) })).status).toBe(200);
    setup.clock.time = T0 + 4 * HOUR + 60 * 1000;
    for (const path of ["/mirror/index", "/mirror/file/papers/a/notes.qmd"]) {
      const response = await send(setup, "GET", path, { headers: bearer(session) });
      expect(response.status).toBe(401);
      expect(await jsonOf(response)).toMatchObject({ error: "unauthorized" });
    }
  });

  it("1.3c refuses a tampered session", async () => {
    const { setup, session } = await filled();
    for (const forged of [flipMiddle(session), `${session}x`, session.slice(0, -4), `x${session}`, "garbage"]) {
      const response = await send(setup, "GET", "/mirror/index", { headers: bearer(forged) });
      expect(response.status).toBe(401);
    }
  });

  it("1.3c refuses a session signed under another owner secret", async () => {
    const { setup, session } = await filled();
    const other = { ...setup.env, OWNER_SECRET: "a-different-owner-secret" } as RelayEnv;
    expect((await send(setup, "GET", "/mirror/index", { headers: bearer(session), env: other })).status).toBe(401);
  });

  it("1.3c answers a preflight and carries CORS on reads and refusals", async () => {
    const { setup, session } = await filled();
    const preflight = await send(setup, "OPTIONS", "/mirror/index");
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    const read = await send(setup, "GET", "/mirror/index", { headers: bearer(session) });
    expect(read.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const refused = await send(setup, "GET", "/mirror/index");
    expect(refused.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("1.3d limits", () => {
  it("1.3d refuses a rows request over 1 MiB as tooLarge and stores nothing from it", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    const response = await putRows(setup, [row("papers/a/notes.qmd", "x".repeat(1024 * 1024 + 1))]);
    expect(response.status).toBe(413);
    expect(await jsonOf(response)).toMatchObject({ error: "tooLarge" });
    expect(await indexedPaths(setup, await openSession(setup))).toEqual([]);
  });

  it("1.3d accepts a rows request just under 1 MiB", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    const response = await putRows(setup, [row("papers/a/notes.qmd", "x".repeat(1000 * 1000))]);
    expect(response.status).toBe(200);
    expect(await indexedPaths(setup, await openSession(setup))).toEqual(["papers/a/notes.qmd"]);
  });

  it("1.3d rate-limits /mirror/session per Worker with rateLimited and 429", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    let limitedAt = -1;
    for (let attempt = 1; attempt <= 2000 && limitedAt < 0; attempt += 1) {
      const response = await send(setup, "POST", "/mirror/session", { body: { accessToken: "guess" } });
      if (response.status === 429) {
        expect(await jsonOf(response)).toMatchObject({ error: "rateLimited" });
        limitedAt = attempt;
      } else {
        expect(await jsonOf(response)).toMatchObject({ error: "unauthorized" });
      }
    }
    expect(limitedAt).toBeGreaterThan(1);
  });

  it("1.3d keeps refusing the owner's own token while the hour's limit is spent, and lifts it in the next hour", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    let limited = false;
    for (let attempt = 0; attempt < 2000 && !limited; attempt += 1) {
      limited = (await send(setup, "POST", "/mirror/session", { body: { accessToken: "guess" } })).status === 429;
    }
    expect(limited).toBe(true);
    const during = await send(setup, "POST", "/mirror/session", { body: { accessToken: OWNER_TOKEN } });
    expect(during.status).toBe(429);
    expect(await jsonOf(during)).toMatchObject({ error: "rateLimited" });
    setup.clock.time = T0 + HOUR + 60 * 1000;
    expect(await openSession(setup)).toBeTruthy();
  });
});

describe("1.3e deploy and protocol minor", () => {
  const script = "export default { fetch() { return new Response('ok'); } };";

  async function uploadedMetadata() {
    const cloudflare = fakeCloudflare();
    await deployRelay({ token: TOKEN, accountId: ACCOUNT, script, workerName: "relay", logger: recordingLogger(), fetch: cloudflare.fetch });
    const upload = cloudflare.requests.find((request) => request.path.endsWith("/workers/scripts/relay"))!;
    return metadataOf(upload);
  }

  it("1.3e binds MIRROR with class Mirror next to ROOM, INBOX and KV", async () => {
    const metadata = await uploadedMetadata();
    expect(metadata.bindings).toEqual(expect.arrayContaining([
      { type: "durable_object_namespace", name: "MIRROR", class_name: "Mirror" },
      { type: "durable_object_namespace", name: "ROOM", class_name: "Room" },
      { type: "durable_object_namespace", name: "INBOX", class_name: "Inbox" },
      { type: "kv_namespace", name: "KV", namespace_id: "kv-1" },
    ]));
  });

  it("1.3e sends the v3 migration that creates Mirror on a new Worker", async () => {
    const metadata = await uploadedMetadata();
    expect(metadata.migrations).toMatchObject({
      new_tag: "v3",
      steps: [{ new_sqlite_classes: ["Room"] }, { new_sqlite_classes: ["Inbox"] }, { new_sqlite_classes: ["Mirror"] }],
    });
    expect(RELAY_MIGRATIONS.at(-1)).toEqual({ tag: "v3", new_sqlite_classes: ["Mirror"] });
  });

  it("1.3e raises the protocol minor above 1 and keeps the major, so the Worker build moves with it", () => {
    expect(RELAY_PROTOCOL_MINOR).toBeGreaterThan(1);
    expect(RELAY_PROTOCOL_VERSION).toBe(`2.${RELAY_PROTOCOL_MINOR}`);
    expect(RELAY_WORKER_BUILD.startsWith(`2.${RELAY_PROTOCOL_MINOR}.`)).toBe(true);
  });
});
