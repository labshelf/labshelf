/** Pins the relay Worker's endpoints: version, owner-only claims, tickets bound to a share and time; the share endpoints with
 * public CORS reads, owner-only writes and deletes, hash-checked blobs and the 25 MiB limit; and the share client against the
 * real handler: build, upload, open, read a PDF, revoke, and the link reads as removed. */
import { bytesToBase64Url, bytesToHex } from "../../../src/encoding/index";
import type { ILogger } from "../../../src/ports/index";
import { RELAY_WORKER_BUILD } from "../../../src/relay/index";
import worker from "../../../src/relay/worker/index";
import {
  buildShare, createWorkerShareBackend, createWorkerShareReader, openShare, removeShare, uploadShare, type ShareRegistryStore,
} from "../../../src/share/index";
import { fakeEnv, fakeKv, KV_VALUE_LIMIT, OWNER_SECRET } from "./fakeRoomRuntime";

const shareId = "0123456789abcdef0123456789abcdef";
const otherShare = "fedcba9876543210fedcba9876543210";
const tokenBytes = new Uint8Array(32).fill(5);
const relayToken = bytesToBase64Url(tokenBytes);
const BASE = "https://relay.example.workers.dev";

async function tokenHash(bytes: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)));
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

const owner = { Authorization: `Bearer ${OWNER_SECRET}` };

async function claimed(overrides = {}) {
  const fake = fakeEnv(overrides);
  const response = await worker.fetch(post("/claim", { v: "2.0", shareId, relayTokenHash: await tokenHash(tokenBytes) }, owner), fake.env);
  expect(response.status).toBe(200);
  return fake;
}

async function ticketFor(fake: ReturnType<typeof fakeEnv>, id = shareId): Promise<string> {
  const response = await worker.fetch(post("/ticket", { v: "2.0", shareId: id, relayToken }), fake.env);
  expect(response.status).toBe(200);
  return ((await response.json()) as { ticket: string }).ticket;
}

const upgrade = (id: string, ticket: string) =>
  new Request(`${BASE}/project/${id}?ticket=${encodeURIComponent(ticket)}`, { headers: { Upgrade: "websocket" } });

describe("relay worker", () => {
  it("reports its build and answers CORS preflights", async () => {
    const { env } = fakeEnv();
    const version = await worker.fetch(new Request(`${BASE}/version`), env);
    expect(await version.json()).toEqual({ v: "2.0", worker: RELAY_WORKER_BUILD });
    expect(version.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect((await worker.fetch(new Request(`${BASE}/claim`, { method: "OPTIONS" }), env)).status).toBe(204);
  });

  it("claims a share only with the owner secret, and only once per hash", async () => {
    const { env } = fakeEnv();
    const body = { v: "2.0", shareId, relayTokenHash: await tokenHash(tokenBytes) };
    expect((await worker.fetch(post("/claim", body), env)).status).toBe(401);
    expect((await worker.fetch(post("/claim", body, { Authorization: "Bearer wrong" }), env)).status).toBe(401);
    expect((await worker.fetch(post("/claim", body, owner), env)).status).toBe(200);
    expect((await worker.fetch(post("/claim", body, owner), env)).status).toBe(200);
    const other = await worker.fetch(post("/claim", { ...body, relayTokenHash: "0".repeat(64) }, owner), env);
    expect([other.status, await other.json()]).toEqual([409, { v: "2.0", error: "claimed" }]);
    expect((await worker.fetch(post("/claim", { ...body, v: "9.0" }, owner), env)).status).toBe(400);
  });

  it("refuses a ticket for an unclaimed share or a wrong relay token", async () => {
    const fake = await claimed();
    const wrong = await worker.fetch(post("/ticket", { v: "2.0", shareId, relayToken: bytesToBase64Url(new Uint8Array(32)) }), fake.env);
    expect([wrong.status, await wrong.json()]).toEqual([403, { v: "2.0", error: "forbidden" }]);
    expect((await worker.fetch(post("/ticket", { v: "2.0", shareId: otherShare, relayToken }), fake.env)).status).toBe(403);
  });

  it("opens the share's socket with its ticket and refuses a bad, foreign or expired one", async () => {
    const fake = await claimed();
    const ticket = await ticketFor(fake);
    expect((await worker.fetch(upgrade(shareId, ticket), fake.env)).status).toBe(200);
    expect(fake.upgrades).toHaveLength(1);
    expect((await worker.fetch(upgrade(otherShare, ticket), fake.env)).status).toBe(401);
    expect((await worker.fetch(upgrade(shareId, `${ticket.slice(0, -1)}${ticket.endsWith("A") ? "E" : "A"}`), fake.env)).status).toBe(401);
    expect((await worker.fetch(upgrade(shareId, "garbage"), fake.env)).status).toBe(401);
    expect((await worker.fetch(post("/claim", {}), fakeEnv({ OWNER_SECRET: "another" }).env)).status).toBe(401);
    const expired = Date.now() + 301 * 1000;
    jest.spyOn(Date, "now").mockReturnValue(expired);
    expect((await worker.fetch(upgrade(shareId, ticket), fake.env)).status).toBe(401);
    expect(fake.upgrades).toHaveLength(1);
  });
});

const manifest = new Uint8Array([1, 2, 3, 4]);
const blob = new Uint8Array([9, 8, 7, 6, 5]);

async function sha256(bytes: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)));
}

function call(env: ReturnType<typeof fakeEnv>["env"], method: string, path: string, init: { headers?: Record<string, string> | undefined; body?: Uint8Array | undefined } = {}) {
  return worker.fetch(new Request(`${BASE}${path}`, { method, ...(init.headers && { headers: init.headers }), ...(init.body && { body: init.body as BodyInit }) }), env);
}

const bytesOf = async (response: Response) => new Uint8Array(await response.arrayBuffer());

async function stored() {
  const { env } = fakeEnv();
  const hash = await sha256(blob);
  expect((await call(env, "PUT", `/share/${shareId}/blob/${hash}`, { headers: owner, body: blob })).status).toBe(204);
  expect((await call(env, "PUT", `/share/${shareId}/manifest`, { headers: owner, body: manifest })).status).toBe(204);
  return { env, hash };
}

afterEach(() => { jest.restoreAllMocks(); });

describe("worker share endpoints", () => {
  it("serves the manifest and blobs to anyone, with CORS for any origin", async () => {
    const { env, hash } = await stored();
    const read = await call(env, "GET", `/share/${shareId}/manifest`);
    expect([read.status, read.headers.get("Access-Control-Allow-Origin")]).toEqual([200, "*"]);
    expect(await bytesOf(read)).toEqual(manifest);
    const blobRead = await call(env, "GET", `/share/${shareId}/blob/${hash}`);
    expect(blobRead.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await bytesOf(blobRead)).toEqual(blob);
    const preflight = await call(env, "OPTIONS", `/share/${shareId}/blob/${hash}`);
    expect(preflight.status).toBe(204);
    for (const method of ["PUT", "DELETE", "HEAD"]) { expect(preflight.headers.get("Access-Control-Allow-Methods")).toContain(method); }
  });

  it("answers a missing manifest or blob with 404 and a bad id or hash with malformed", async () => {
    const { env, hash } = await stored();
    const other = "f".repeat(32);
    expect((await call(env, "GET", `/share/${other}/manifest`)).status).toBe(404);
    expect((await call(env, "GET", `/share/${shareId}/blob/${"0".repeat(64)}`)).status).toBe(404);
    for (const path of [`/share/xyz/manifest`, `/share/${shareId}/blob/${hash.slice(1)}`, `/share/${shareId.toUpperCase()}/manifest`]) {
      const response = await call(env, "GET", path);
      expect([response.status, await response.json()]).toEqual([400, { v: "2.0", error: "malformed" }]);
    }
    expect((await call(env, "GET", `/share/${shareId}/other`)).status).toBe(404);
  });

  it("requires the owner secret to write, check or delete", async () => {
    const { env, hash } = await stored();
    const wrong = { Authorization: "Bearer nope" };
    const attempts: [string, string, Uint8Array?][] = [
      ["PUT", `/share/${shareId}/manifest`, manifest], ["PUT", `/share/${shareId}/blob/${hash}`, blob],
      ["DELETE", `/share/${shareId}/manifest`], ["DELETE", `/share/${shareId}/blob/${hash}`], ["HEAD", `/share/${shareId}/blob/${hash}`],
    ];
    for (const [method, path, body] of attempts) {
      expect((await call(env, method, path, { body })).status).toBe(401);
      expect((await call(env, method, path, { headers: wrong, body })).status).toBe(401);
    }
    const refused = await call(env, "DELETE", `/share/${shareId}/manifest`);
    expect(await refused.json()).toEqual({ v: "2.0", error: "unauthorized" });
    expect((await call(env, "GET", `/share/${shareId}/manifest`)).status).toBe(200);
  });

  it("refuses every owner request when the Worker has no owner secret", async () => {
    const { env } = fakeEnv();
    delete env.OWNER_SECRET;
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await call(env, "PUT", `/share/${shareId}/manifest`, { headers: { Authorization: "Bearer undefined" }, body: manifest })).status).toBe(401);
  });

  it("checks a blob upload against the hash in its path", async () => {
    const { env } = fakeEnv();
    const wrongHash = await sha256(manifest);
    const refused = await call(env, "PUT", `/share/${shareId}/blob/${wrongHash}`, { headers: owner, body: blob });
    expect([refused.status, await refused.json()]).toEqual([400, { v: "2.0", error: "malformed" }]);
    expect((env.KV as ReturnType<typeof fakeKv>).entries.size).toBe(0);
  });

  it("tells the owner whether a blob is stored, whatever the manifest", async () => {
    const { env, hash } = await stored();
    expect((await call(env, "HEAD", `/share/${shareId}/blob/${hash}`, { headers: owner })).status).toBe(200);
    expect((await call(env, "HEAD", `/share/${shareId}/blob/${"1".repeat(64)}`, { headers: owner })).status).toBe(404);
    await call(env, "DELETE", `/share/${shareId}/manifest`, { headers: owner });
    expect((await call(env, "HEAD", `/share/${shareId}/blob/${hash}`, { headers: owner })).status).toBe(200);
  });

  it("reads no blob once the manifest is deleted, and deletes again with 204", async () => {
    const { env, hash } = await stored();
    expect((await call(env, "DELETE", `/share/${shareId}/manifest`, { headers: owner })).status).toBe(204);
    expect((await call(env, "GET", `/share/${shareId}/manifest`)).status).toBe(404);
    expect((await call(env, "GET", `/share/${shareId}/blob/${hash}`)).status).toBe(404);
    expect((await call(env, "DELETE", `/share/${shareId}/manifest`, { headers: owner })).status).toBe(204);
    expect((await call(env, "DELETE", `/share/${shareId}/blob/${hash}`, { headers: owner })).status).toBe(204);
    expect((await call(env, "DELETE", `/share/${shareId}/blob/${hash}`, { headers: owner })).status).toBe(204);
    expect((await call(env, "HEAD", `/share/${shareId}/blob/${hash}`, { headers: owner })).status).toBe(404);
  });

  it("refuses a body over the KV value limit with tooLarge", async () => {
    const { env } = fakeEnv();
    const huge = new Uint8Array(KV_VALUE_LIMIT + 1);
    const refused = await call(env, "PUT", `/share/${shareId}/manifest`, { headers: owner, body: huge });
    expect([refused.status, await refused.json()]).toEqual([413, { v: "2.0", error: "tooLarge" }]);
    const blobRefused = await call(env, "PUT", `/share/${shareId}/blob/${await sha256(huge)}`, { headers: owner, body: huge });
    expect(blobRefused.status).toBe(413);
    expect((env.KV as ReturnType<typeof fakeKv>).entries.size).toBe(0);
  });

  it("keys the KV by share id for manifests and by hash for blobs, so shares reuse a blob", async () => {
    const { env } = await stored();
    const kv = (env.KV as ReturnType<typeof fakeKv>).entries;
    expect([...kv.keys()].sort()).toEqual([`blob:${await sha256(blob)}`, `share:${shareId}:manifest`].sort());
  });
});

const relayUrl = "https://relay.someone.workers.dev";
const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

describe("share over the relay Worker", () => {
  it("uploads, opens, reads a PDF and revokes", async () => {
    const { env } = fakeEnv();
    const workerFetch = ((input: RequestInfo | URL, init?: RequestInit) => worker.fetch(new Request(input, init), env)) as typeof fetch;
    const store: ShareRegistryStore & { text?: string } = {
      read: async () => store.text, write: async (text) => { store.text = text; }, exclusive: (run) => run(),
    };
    const pdf = new Uint8Array(3000).map((_, index) => (index * 7) % 251);
    const share = await buildShare({
      folderName: "Reading group", withAnnotations: false,
      papers: [{ metadata: { id: "a", title: "A", citeKey: "a" }, pdf }],
    });
    const backend = createWorkerShareBackend({ relayUrl, ownerSecret: OWNER_SECRET, fetch: workerFetch });
    const link = await uploadShare({ share, relayUrl, backend, registry: store, logger });

    const readerFor = () => createWorkerShareReader({ relayUrl, fetch: workerFetch });
    const opened = await openShare(link, readerFor);
    if (!opened.ok) { throw new Error(`openShare failed: ${opened.error}`); }
    expect(opened.share.manifest.folder).toBe("Reading group");
    const loaded = await opened.share.loadPdf(opened.share.manifest.papers[0]!);
    expect(loaded).toEqual({ ok: true, bytes: pdf });

    expect(await removeShare(share.shareId, { registry: store, backendFor: () => backend, logger })).toBe(true);
    expect(await openShare(link, readerFor)).toEqual({ ok: false, error: "removed" });
  });

  it("refuses an upload made with the wrong owner secret", async () => {
    const { env } = fakeEnv();
    const workerFetch = ((input: RequestInfo | URL, init?: RequestInit) => worker.fetch(new Request(input, init), env)) as typeof fetch;
    const backend = createWorkerShareBackend({ relayUrl, ownerSecret: "wrong", fetch: workerFetch });
    await expect(backend.putManifest("0123456789abcdef0123456789abcdef", new Uint8Array(3))).rejects.toMatchObject({ code: "unauthorized", status: 401 });
  });
});
