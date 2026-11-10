/** Pins the share Worker: the share endpoints with public CORS reads, owner-only writes and deletes, hash-checked blobs and the
 * 25 MiB limit; the relay Worker refusing /share/*; and an account whose links upload to and revoke from its share Worker,
 * which connect deploys beside the relay and disconnect removes with it. */
import { bytesToHex } from "../../../src/encoding/index";
import type { ILogger } from "../../../src/ports/index";
import { connectRelayAccount, formatRelayHost, RELAY_PROTOCOL_VERSION, removeRelayAccount, type RelayAccount } from "../../../src/relay/index";
import relayWorker from "../../../src/relay/worker/index";
import shareWorker from "../../../src/relay/worker/shareWorker";
import {
  buildShare, createWorkerShareBackend, createWorkerShareReader, openShare, removeShare, resolveRelayBackend, uploadShare,
  type ShareRegistryStore,
} from "../../../src/share/index";
import { accountWorld, connectedAccount, routes, signIn } from "../fakeRelayAccount";
import { metadataOf } from "../fakeCloudflare";
import { fakeEnv, fakeKv, KV_VALUE_LIMIT, OWNER_SECRET } from "./fakeRoomRuntime";

const shareId = "0123456789abcdef0123456789abcdef";
const BASE = "https://ls-sharewrkr234.lab.workers.dev";
const owner = { Authorization: `Bearer ${OWNER_SECRET}` };
const manifest = new Uint8Array([1, 2, 3, 4]);
const blob = new Uint8Array([9, 8, 7, 6, 5]);

const shareEnv = () => ({ KV: fakeKv(), OWNER_SECRET } as { KV: ReturnType<typeof fakeKv>; OWNER_SECRET?: string });
type ShareEnv = ReturnType<typeof shareEnv>;

async function sha256(bytes: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)));
}

function call(env: ShareEnv, method: string, path: string, init: { headers?: Record<string, string> | undefined; body?: Uint8Array | undefined } = {}) {
  return shareWorker.fetch(new Request(`${BASE}${path}`, { method, ...(init.headers && { headers: init.headers }), ...(init.body && { body: init.body as BodyInit }) }), env);
}

const bytesOf = async (response: Response) => new Uint8Array(await response.arrayBuffer());

async function stored() {
  const env = shareEnv();
  const hash = await sha256(blob);
  expect((await call(env, "PUT", `/share/${shareId}/blob/${hash}`, { headers: owner, body: blob })).status).toBe(204);
  expect((await call(env, "PUT", `/share/${shareId}/manifest`, { headers: owner, body: manifest })).status).toBe(204);
  return { env, hash };
}

afterEach(() => { jest.restoreAllMocks(); });

describe("share worker endpoints", () => {
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
      expect([response.status, await response.json()]).toEqual([400, { v: RELAY_PROTOCOL_VERSION, error: "malformed" }]);
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
    expect(await refused.json()).toEqual({ v: RELAY_PROTOCOL_VERSION, error: "unauthorized" });
    expect((await call(env, "GET", `/share/${shareId}/manifest`)).status).toBe(200);
  });

  it("refuses every owner request when the Worker has no owner secret", async () => {
    const env = shareEnv();
    delete env.OWNER_SECRET;
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await call(env, "PUT", `/share/${shareId}/manifest`, { headers: { Authorization: "Bearer undefined" }, body: manifest })).status).toBe(401);
  });

  it("checks a blob upload against the hash in its path", async () => {
    const env = shareEnv();
    const wrongHash = await sha256(manifest);
    const refused = await call(env, "PUT", `/share/${shareId}/blob/${wrongHash}`, { headers: owner, body: blob });
    expect([refused.status, await refused.json()]).toEqual([400, { v: RELAY_PROTOCOL_VERSION, error: "malformed" }]);
    expect(env.KV.entries.size).toBe(0);
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
    const env = shareEnv();
    const huge = new Uint8Array(KV_VALUE_LIMIT + 1);
    const refused = await call(env, "PUT", `/share/${shareId}/manifest`, { headers: owner, body: huge });
    expect([refused.status, await refused.json()]).toEqual([413, { v: RELAY_PROTOCOL_VERSION, error: "tooLarge" }]);
    const blobRefused = await call(env, "PUT", `/share/${shareId}/blob/${await sha256(huge)}`, { headers: owner, body: huge });
    expect(blobRefused.status).toBe(413);
    expect(env.KV.entries.size).toBe(0);
  });

  it("keys the KV by share id for manifests and by hash for blobs, so shares reuse a blob", async () => {
    const { env } = await stored();
    const kv = env.KV.entries;
    expect([...kv.keys()].sort()).toEqual([`blob:${await sha256(blob)}`, `share:${shareId}:manifest`].sort());
  });
});

describe("relay worker without share endpoints", () => {
  it("refuses /share/* reads and owner writes and stores nothing", async () => {
    const { env } = fakeEnv();
    const hash = await sha256(blob);
    const attempts: [string, string, Uint8Array?][] = [
      ["GET", `/share/${shareId}/manifest`], ["PUT", `/share/${shareId}/manifest`, manifest], ["PUT", `/share/${shareId}/blob/${hash}`, blob],
      ["HEAD", `/share/${shareId}/blob/${hash}`], ["DELETE", `/share/${shareId}/manifest`],
    ];
    for (const [method, path, body] of attempts) {
      const request = new Request(`https://ls-relayrelay23.lab.workers.dev${path}`, { method, headers: owner, ...(body && { body: body as BodyInit }) });
      expect((await relayWorker.fetch(request, env)).status).toBe(404);
    }
    expect((env.KV as ReturnType<typeof fakeKv>).entries.size).toBe(0);
  });
});

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const PASTED = { kind: "token" as const, token: "access-1" };
const NAME = /^ls-[a-z2-7]{12}$/;

async function connectedWorld() {
  const world = accountWorld();
  const connect = () => connectRelayAccount({
    ...world.deps, chooseCredential: async () => PASTED, chooseAccount: async () => undefined, offerToShares: async () => undefined,
    script: "// relay bundle", shareScript: "// share bundle",
  });
  await connect();
  const account = (await world.store.get())!;
  return { world, account };
}

const bindingsOf = async (form: FormData | undefined) =>
  ((await metadataOf({ method: "PUT", path: "", headers: {}, form })).bindings as { type: string; namespace_id?: string }[]);

describe("connect deploys a separate share Worker", () => {
  it("stores a share Worker with its own random name, address, secret and KV namespace", async () => {
    const { world, account } = await connectedWorld();
    const { shareWorker: share } = account;
    expect(share.name).toMatch(NAME);
    expect(share.name).not.toBe(account.workerName);
    expect(share.url).toBe(`https://${share.name}.lab.workers.dev`);
    expect(share.kvNamespaceId).not.toBe(account.kvNamespaceId);
    expect(share.ownerSecret).toBe(world.scripts.get(share.name)?.secret);
    expect(share.ownerSecret).not.toBe(account.ownerSecret);
    expect(account.ownerSecret).toBe(world.scripts.get(account.workerName)?.secret);
    const titles = world.cloudflare.requests.filter((request) => request.method === "POST" && request.path.endsWith("/storage/kv/namespaces"))
      .map((request) => (request.json as { title: string }).title);
    expect(titles).toEqual(["labshelf-relay", "labshelf-share"]);
  });

  it("uploads the share bundle with only its KV binding, and the relay bundle with its room", async () => {
    const { world, account } = await connectedWorld();
    const shareForm = world.scripts.get(account.shareWorker.name)?.form;
    expect(await (shareForm?.get("worker.js") as Blob).text()).toBe("// share bundle");
    expect(await bindingsOf(shareForm)).toEqual([{ type: "kv_namespace", name: "KV", namespace_id: account.shareWorker.kvNamespaceId }]);
    expect((await metadataOf({ method: "PUT", path: "", headers: {}, form: shareForm })).migrations).toBeUndefined();
    const relayForm = world.scripts.get(account.workerName)?.form;
    expect(await (relayForm?.get("worker.js") as Blob).text()).toBe("// relay bundle");
    expect((await bindingsOf(relayForm)).map((binding) => binding.type)).toContain("durable_object_namespace");
  });

  it("refuses an account without a share Worker", async () => {
    const world = accountWorld();
    const { shareWorker: _share, ...old } = connectedAccount;
    world.slots.account.value = JSON.stringify(old);
    expect(await world.store.get()).toBeUndefined();
  });
});

describe("links of a new account", () => {
  function routeWorkers(account: RelayAccount, secrets: { relay: string; share: string }) {
    const relay = fakeEnv({ OWNER_SECRET: secrets.relay });
    const share = { KV: fakeKv(), OWNER_SECRET: secrets.share };
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      const host = new URL(request.url).host;
      if (host === new URL(account.shareWorker.url).host) { return shareWorker.fetch(request, share); }
      if (host === new URL(account.relayUrl).host) { return relayWorker.fetch(request, relay.env); }
      throw new TypeError(`no route to ${host}`);
    });
    return { relayKv: relay.env.KV as ReturnType<typeof fakeKv>, shareKv: share.KV };
  }

  it("uploads to and revokes from the share Worker; the relay holds nothing", async () => {
    const { account } = await connectedWorld();
    const { relayKv, shareKv } = routeWorkers(account, { relay: account.ownerSecret, share: account.shareWorker.ownerSecret });
    const store: ShareRegistryStore & { text?: string } = {
      read: async () => store.text, write: async (text) => { store.text = text; }, exclusive: (run) => run(),
    };
    const pdf = new Uint8Array(3000).map((_, index) => (index * 7) % 251);
    const share = await buildShare({ folderName: "Reading group", withAnnotations: false, papers: [{ metadata: { id: "a", title: "A", citeKey: "a" }, pdf }] });
    const backendFor = resolveRelayBackend(account);
    const relayUrl = account.shareWorker.url;
    const link = await uploadShare({ share, relayUrl, backend: backendFor(relayUrl), registry: store, logger });
    expect(link).toContain(`#${formatRelayHost(account.shareWorker.url)}.`);
    expect(JSON.parse(store.text!).shares[0].relayUrl).toBe(account.shareWorker.url);
    expect(shareKv.entries.size).toBeGreaterThan(0);
    expect(relayKv.entries.size).toBe(0);

    const readerFor = (url: string) => createWorkerShareReader({ relayUrl: url });
    const opened = await openShare(link, readerFor);
    if (!opened.ok) { throw new Error(`openShare failed: ${opened.error}`); }
    expect(await opened.share.loadPdf(opened.share.manifest.papers[0]!)).toEqual({ ok: true, bytes: pdf });

    expect(await removeShare(share.shareId, { registry: store, backendFor, logger })).toBe(true);
    expect(shareKv.entries.size).toBe(0);
    expect(await openShare(link, readerFor)).toEqual({ ok: false, error: "removed" });
  });

  it("refuses to write a share through the relay Worker's address", async () => {
    const { account } = await connectedWorld();
    expect(() => resolveRelayBackend(account)(account.relayUrl)).toThrow(/not connected/);
  });

  it("refuses an upload made with the relay's owner secret", async () => {
    const { account } = await connectedWorld();
    routeWorkers(account, { relay: account.ownerSecret, share: account.shareWorker.ownerSecret });
    const backend = createWorkerShareBackend({ relayUrl: account.shareWorker.url, ownerSecret: account.ownerSecret });
    await expect(backend.putManifest(shareId, new Uint8Array(3))).rejects.toMatchObject({ code: "unauthorized", status: 401 });
  });
});

describe("disconnect removes both Workers", () => {
  it("deletes the relay and the share Worker and both KV namespaces, then forgets the account", async () => {
    const world = accountWorld();
    signIn(world);
    await world.store.save(connectedAccount);
    await removeRelayAccount({ ...world.deps, withdrawFromShares: async () => undefined });
    const deletes = routes(world).filter((route) => route.startsWith("DELETE"));
    expect(deletes).toEqual(expect.arrayContaining([
      "DELETE /accounts/<A>/storage/kv/namespaces/kv-1", "DELETE /accounts/<A>/storage/kv/namespaces/kv-2",
    ]));
    expect(world.scriptCalls.filter((entry) => entry.startsWith("DELETE")).sort())
      .toEqual([`DELETE ${connectedAccount.workerName}`, `DELETE ${connectedAccount.shareWorker.name}`].sort());
    expect(await world.store.get()).toBeUndefined();
  });

  it("keeps the account when the deletions fail, so it can be retried", async () => {
    const world = accountWorld({ failDeletes: true });
    signIn(world);
    await world.store.save(connectedAccount);
    await expect(removeRelayAccount({ ...world.deps, withdrawFromShares: async () => undefined })).rejects.toThrow();
    expect(await world.store.get()).toEqual(connectedAccount);
  });
});
