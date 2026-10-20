// Pins the browser share list store: per-library text in extension storage, sections serialised by a Web Lock, malformed text kept.
import { buildShare, revokeShare, updateShareRegistry, uploadShare, type ILogger, type ShareBackend } from "@labshelf/core";
import { createBrowserShareRegistryStore, type ShareListArea } from "../../src/share";
import { installFakeLocks } from "../support/fakeLocks";

function memoryArea(): ShareListArea & { items: Map<string, unknown> } {
  const items = new Map<string, unknown>();
  return {
    items,
    get: async (key) => (items.has(key) ? { [key]: items.get(key) } : {}),
    set: async (values) => { for (const [key, value] of Object.entries(values)) items.set(key, value); },
  };
}

const logger: ILogger = { log: async () => undefined, error: async () => undefined };
const SHARE_ID = "0123456789abcdef0123456789abcdef";
const LIST = `{"shares":[{"id":"${SHARE_ID}","folder":"A","relayUrl":"https://r.example.workers.dev","key":"k","createdAt":"2026-10-20T00:00:00.000Z","blobs":[]}]}`;

const refusingBackend: ShareBackend = {
  putManifest: async () => { throw new Error("no network in this test"); },
  putBlob: async () => { throw new Error("no network in this test"); },
  hasBlob: async () => { throw new Error("no network in this test"); },
  deleteManifest: async () => { throw new Error("no network in this test"); },
  deleteBlob: async () => { throw new Error("no network in this test"); },
};

beforeEach(() => { installFakeLocks(); });

describe("createBrowserShareRegistryStore", () => {
  it("reads a missing list as undefined", async () => {
    const store = createBrowserShareRegistryStore(memoryArea(), async () => "lib-1");
    await expect(store.read()).resolves.toBeUndefined();
  });

  it("returns the text it wrote", async () => {
    const store = createBrowserShareRegistryStore(memoryArea(), async () => "lib-1");
    await store.write(LIST);
    await expect(store.read()).resolves.toBe(LIST);
  });

  it("keeps each library's list apart", async () => {
    const area = memoryArea();
    const one = createBrowserShareRegistryStore(area, async () => "lib-1");
    const two = createBrowserShareRegistryStore(area, async () => "lib-2");
    await one.write(LIST);
    await expect(two.read()).resolves.toBeUndefined();
    await two.write('{"shares":[]}');
    await expect(one.read()).resolves.toBe(LIST);
  });

  it("runs one exclusive section at a time, so concurrent edits keep both changes", async () => {
    const area = memoryArea();
    // Two stores over one library stand for two tabs of the page.
    const tabA = createBrowserShareRegistryStore(area, async () => "lib-1");
    const tabB = createBrowserShareRegistryStore(area, async () => "lib-1");
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = tabA.exclusive(async () => {
      order.push("a:start");
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      order.push("a:end");
    });
    const second = tabB.exclusive(async () => { order.push("b"); });
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["a:start", "a:end", "b"]);

    const record = (id: string) => ({ id, folder: id, relayUrl: "https://r.example.workers.dev", key: "k", createdAt: "x", blobs: [] });
    await Promise.all([
      updateShareRegistry(tabA, (listed) => ({ shares: [...listed.shares, record("a".repeat(32))] })),
      updateShareRegistry(tabB, (listed) => ({ shares: [...listed.shares, record("b".repeat(32))] })),
    ]);
    const stored = JSON.parse((await tabA.read())!) as { shares: { id: string }[] };
    expect(stored.shares.map((share) => share.id).sort()).toEqual(["a".repeat(32), "b".repeat(32)]);
  });

  it("keeps a malformed list verbatim when an upload or a revoke refuses it", async () => {
    const area = memoryArea();
    const store = createBrowserShareRegistryStore(area, async () => "lib-1");
    await store.write("{not json");
    const share = await buildShare({ folderName: "A", papers: [], withAnnotations: false });
    await expect(uploadShare({ share, relayUrl: "https://r.example.workers.dev", backend: refusingBackend, registry: store, logger })).rejects.toThrow(/not JSON/);
    await expect(revokeShare(SHARE_ID, { registry: store, backendFor: () => refusingBackend, logger })).rejects.toThrow(/not JSON/);
    await expect(store.read()).resolves.toBe("{not json");
  });
});
