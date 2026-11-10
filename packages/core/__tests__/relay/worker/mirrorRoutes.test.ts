/** Pins the relay's /mirror/* routes: owner-secret writes, status, settings and edits, the Cloudflare-token session exchange, session-token
 * reads and edits, the 8 MiB rows and 64 MiB file limits, the refusals passed on from the Mirror, and the session rate limit. */
import { DatabaseSync } from "node:sqlite";
import { deployRelay, RELAY_PROTOCOL_VERSION } from "../../../src/relay/index";
import worker from "../../../src/relay/worker/index";
import { Mirror } from "../../../src/relay/worker/mirror";
import { answerMirrorRequest } from "../../../src/relay/worker/mirrorRoutes";
import { ACCOUNT, TOKEN, fakeCloudflare, metadataOf, recordingLogger } from "../fakeCloudflare";
import { fakeMirrorState, OWNER_SECRET } from "./fakeRoomRuntime";
import { BASE, HOUR, T0, OWNER_EMAIL, OWNER_TOKEN, OTHER_TOKEN, HASH, ownerAuth, mirrorSetup, send, jsonOf, setOwner, openSession, bearer, row, putRows, indexedPaths, flipMiddle, type Setup } from "./mirrorRoutesFixtures";

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
  it("1.3d refuses a rows request over 8 MiB as tooLarge and stores nothing from it", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    const response = await putRows(setup, [row("papers/a/notes.qmd", "x".repeat(8 * 1024 * 1024 + 1))]);
    expect(response.status).toBe(413);
    expect(await jsonOf(response)).toMatchObject({ error: "tooLarge" });
    expect(await indexedPaths(setup, await openSession(setup))).toEqual([]);
  });

  it("1.3d accepts a rows request just under 8 MiB", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    const response = await putRows(setup, [row("papers/a/notes.qmd", "x".repeat(8 * 1000 * 1000))]);
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

const bytesOf = (length: number) => Uint8Array.from({ length }, (_, index) => index % 256);
const filePut = (setup: Setup, path: string, body: Uint8Array | string, headers: Record<string, string> = ownerAuth) =>
  answerMirrorRequest(new Request(`${BASE}/mirror/file/${encodeURIComponent(path)}`, {
    method: "PUT", headers: { ...headers, "x-labshelf-kind": "asset", "x-labshelf-hash": HASH }, body: body as BodyInit,
  }), setup.env, setup.deps) as Promise<Response>;
const editRequest = (setup: Setup, method: "PUT" | "DELETE", path: string, base: string, auth: Record<string, string>, body?: string) =>
  send(setup, method, `/mirror/edit/${encodeURIComponent(path)}`, { headers: { ...auth, "x-labshelf-base": base }, ...(body === undefined ? {} : { body }) });

describe("C owner routes: files, status, settings and edits", () => {
  it("C stores raw bytes from PUT /mirror/file with the owner secret and reads them back with the owner secret", async () => {
    const setup = mirrorSetup();
    expect((await filePut(setup, "projects/p/fig.png", bytesOf(500))).status).toBe(200);
    const response = await send(setup, "GET", "/mirror/file/projects%2Fp%2Ffig.png", { headers: ownerAuth });
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytesOf(500));
  });

  it("C decodes a path whose segments are encoded one by one", async () => {
    const setup = mirrorSetup();
    await filePut(setup, "projects/p/a b%.png", bytesOf(4));
    const response = await send(setup, "GET", "/mirror/file/projects/p/a%20b%25.png", { headers: ownerAuth });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytesOf(4));
  });

  it("C refuses PUT /mirror/file with a session", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    expect((await filePut(setup, "a.png", bytesOf(3), bearer(await openSession(setup)))).status).toBe(401);
  });

  it("C refuses GET /mirror/file with neither a session nor the owner secret", async () => {
    const setup = mirrorSetup();
    await filePut(setup, "a.png", bytesOf(3));
    expect((await send(setup, "GET", "/mirror/file/a.png", { headers: { Authorization: "Bearer nope" } })).status).toBe(401);
  });

  it("C refuses a file over 64 MiB by its actual length and stores nothing", async () => {
    const setup = mirrorSetup();
    const response = await filePut(setup, "big.pdf", bytesOf(64 * 1024 * 1024 + 1));
    expect(response.status).toBe(413);
    expect(await jsonOf(response)).toMatchObject({ error: "tooLarge" });
    expect(setup.db.prepare("SELECT COUNT(*) AS n FROM rows").get()).toEqual({ n: 0 });
  });

  it("C accepts a file of exactly 64 MiB", async () => {
    expect((await filePut(mirrorSetup(), "big.pdf", bytesOf(64 * 1024 * 1024))).status).toBe(200);
  });

  it("C answers GET /mirror/status with v and refuses it without the owner secret", async () => {
    const setup = mirrorSetup();
    const status = await jsonOf(await send(setup, "GET", "/mirror/status", { headers: ownerAuth }));
    expect(status).toMatchObject({ v: RELAY_PROTOCOL_VERSION, store: "do", used: 0, limit: 5_000_000_000, includePdfs: false, rows: 0, edits: 0 });
    expect((status.r2 as { bound: boolean }).bound).toBe(true);
    expect((await send(setup, "GET", "/mirror/status")).status).toBe(401);
  });

  it("C answers PUT /mirror/settings with the status, and a do limit over 5 GB as malformed 400", async () => {
    const setup = mirrorSetup();
    const answer = await send(setup, "PUT", "/mirror/settings", { headers: ownerAuth, body: { includePdfs: true } });
    expect(await jsonOf(answer)).toMatchObject({ v: RELAY_PROTOCOL_VERSION, includePdfs: true });
    const refused = await send(setup, "PUT", "/mirror/settings", { headers: ownerAuth, body: { limit: 6_000_000_000 } });
    expect(refused.status).toBe(400);
    expect(await jsonOf(refused)).toMatchObject({ error: "malformed" });
  });

  it("C refuses store r2 without the bucket as noBucket 409", async () => {
    const setup = mirrorSetup();
    const mirror = new Mirror(fakeMirrorState(new DatabaseSync(":memory:")), {});
    const env = { ...setup.env, MIRROR: { idFromName: (name: string) => name, get: () => ({ fetch: (request: Request) => mirror.fetch(request) }) } } as RelayEnv;
    const response = await send(setup, "PUT", "/mirror/settings", { headers: ownerAuth, body: { store: "r2" }, env });
    expect(response.status).toBe(409);
    expect(await jsonOf(response)).toEqual({ v: RELAY_PROTOCOL_VERSION, error: "noBucket" });
  });

  it("C answers a put past the limit as full 507 with reason storage", async () => {
    const setup = mirrorSetup();
    await send(setup, "PUT", "/mirror/settings", { headers: ownerAuth, body: { limit: 2 } });
    const response = await putRows(setup, [row("a.qmd", "abc")]);
    expect(response.status).toBe(507);
    expect(await jsonOf(response)).toEqual({ v: RELAY_PROTOCOL_VERSION, error: "full", reason: "storage" });
  });

  it("C lists edits and acks them with the owner secret only", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    const session = await openSession(setup);
    const { hash } = await jsonOf(await editRequest(setup, "PUT", "home.json", "", bearer(session), "{}"));
    expect((await send(setup, "GET", "/mirror/edits", { headers: bearer(session) })).status).toBe(401);
    const edits = await jsonOf(await send(setup, "GET", "/mirror/edits", { headers: ownerAuth }));
    expect(edits).toEqual({ v: RELAY_PROTOCOL_VERSION, edits: [{ path: "home.json", base: "", hash, deleted: false, at: expect.any(Number) }] });
    expect((await send(setup, "POST", "/mirror/edits/ack", { headers: bearer(session), body: { edits: [{ path: "home.json", hash }] } })).status).toBe(401);
    expect((await send(setup, "POST", "/mirror/edits/ack", { headers: ownerAuth, body: { edits: [{ path: "home.json", hash }] } })).status).toBe(200);
    expect(await jsonOf(await send(setup, "GET", "/mirror/edits", { headers: ownerAuth }))).toEqual({ v: RELAY_PROTOCOL_VERSION, edits: [] });
  });
});

describe("C page edits with a session", () => {
  it("C writes an edit and answers its hash", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    const session = await openSession(setup);
    const response = await editRequest(setup, "PUT", "spaces/s/space.json", "", bearer(session), "{\"a\":1}");
    expect(response.status).toBe(200);
    expect(await jsonOf(response)).toEqual({ v: RELAY_PROTOCOL_VERSION, hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(await indexedPaths(setup, session)).toEqual(["spaces/s/space.json"]);
  });

  it("C answers a stale base as conflict 409 with the current hash", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    await putRows(setup, [row("papers/a/notes.qmd", "v1")]);
    const session = await openSession(setup);
    const response = await editRequest(setup, "PUT", "papers/a/notes.qmd", "", bearer(session), "mine");
    expect(response.status).toBe(409);
    expect(await jsonOf(response)).toEqual({ v: RELAY_PROTOCOL_VERSION, error: "conflict", hash: HASH });
  });

  it("C deletes with a matching base", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    await putRows(setup, [row("papers/a/notes.qmd", "v1")]);
    const session = await openSession(setup);
    expect((await editRequest(setup, "DELETE", "papers/a/notes.qmd", HASH, bearer(session))).status).toBe(200);
    expect(await indexedPaths(setup, session)).toEqual([]);
  });

  it("C refuses an edit with the owner secret in place of a session", async () => {
    const setup = mirrorSetup();
    expect((await editRequest(setup, "PUT", "home.json", "", ownerAuth, "{}")).status).toBe(401);
  });

  it("C refuses an edit over 64 MiB as tooLarge", async () => {
    const setup = mirrorSetup();
    await setOwner(setup);
    const session = await openSession(setup);
    const response = await editRequest(setup, "PUT", "home.json", "", bearer(session), "x".repeat(64 * 1024 * 1024 + 1));
    expect(response.status).toBe(413);
  });

  it("C allows the Mirror headers in a preflight", async () => {
    const response = await send(mirrorSetup(), "OPTIONS", "/mirror/edit/home.json");
    expect(response.headers.get("Access-Control-Allow-Headers")).toMatch(/X-Labshelf-Base/);
    expect(response.headers.get("Access-Control-Allow-Headers")).toMatch(/X-Labshelf-Kind/);
  });
});

describe("1.3e deploy", () => {
  it("1.3e binds MIRROR to the share Worker's Mirror class", async () => {
    const cloudflare = fakeCloudflare();
    const script = "export default { fetch() { return new Response('ok'); } };";
    await deployRelay({
      token: TOKEN, accountId: ACCOUNT, script, workerName: "relay", shareWorkerName: "ls-share", logger: recordingLogger(), fetch: cloudflare.fetch,
    });
    const upload = cloudflare.requests.find((request) => request.path.endsWith("/workers/scripts/relay"))!;
    expect((await metadataOf(upload)).bindings).toEqual(expect.arrayContaining([
      { type: "durable_object_namespace", name: "MIRROR", class_name: "Mirror", script_name: "ls-share" },
    ]));
  });
});
