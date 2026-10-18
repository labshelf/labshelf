/** Pins the Worker's share endpoints: public reads with CORS, owner-only writes and deletes, hash-checked blobs, the 25 MiB limit. */
import { bytesToHex } from "../../../src/encoding/index";
import worker from "../../../src/relay/worker/index";
import { fakeKv, KV_VALUE_LIMIT } from "./fakeKv";
import { fakeEnv, OWNER_SECRET } from "./fakeRoomRuntime";

const BASE = "https://relay.example.workers.dev";
const shareId = "0123456789abcdef0123456789abcdef";
const manifest = new Uint8Array([1, 2, 3, 4]);
const blob = new Uint8Array([9, 8, 7, 6, 5]);
const owner = { Authorization: `Bearer ${OWNER_SECRET}` };

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
      expect([response.status, await response.json()]).toEqual([400, { v: "1.1", error: "malformed" }]);
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
    expect(await refused.json()).toEqual({ v: "1.1", error: "unauthorized" });
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
    expect([refused.status, await refused.json()]).toEqual([400, { v: "1.1", error: "malformed" }]);
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
    expect([refused.status, await refused.json()]).toEqual([413, { v: "1.1", error: "tooLarge" }]);
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
