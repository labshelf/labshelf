/** Pins upload and revoke against the device's share list: blob reuse, cleanup of a failed upload, and blobs other shares keep. */
import type { ILogger } from "../../src/ports/index";
import {
  buildShare, loadShareRegistry, revokeShare, uploadShare, type ShareBackend, type ShareRegistryStore,
} from "../../src/share/index";

const relayUrl = "https://relay.someone.workers.dev";
const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const paper = (id: string) => ({ id, title: id, citeKey: id });
const pdf = (seed: number) => new Uint8Array(400).fill(seed);

function memoryBackend() {
  const manifests = new Map<string, Uint8Array>();
  const blobs = new Map<string, Uint8Array>();
  const puts: string[] = [];
  const backend: ShareBackend = {
    putManifest: async (id, bytes) => { manifests.set(id, bytes); },
    putBlob: async (_id, hash, bytes) => { puts.push(hash); blobs.set(hash, bytes); },
    hasBlob: async (_id, hash) => blobs.has(hash),
    deleteManifest: async (id) => { manifests.delete(id); },
    deleteBlob: async (_id, hash) => { blobs.delete(hash); },
  };
  return { backend, manifests, blobs, puts };
}

function memoryStore(initial?: string): ShareRegistryStore & { text: string | undefined } {
  const store = { text: initial, read: async () => store.text, write: async (text: string) => { store.text = text; } };
  return store;
}

describe("uploadShare and revokeShare", () => {
  it("uploads blobs once, the manifest, and lists the share", async () => {
    const remote = memoryBackend();
    const registry = memoryStore();
    const first = await buildShare({ folderName: "A", withAnnotations: false, papers: [{ metadata: paper("a"), pdf: pdf(1) }] });
    const link = await uploadShare({ share: first, relayUrl, backend: remote.backend, registry, logger, now: () => new Date(0) });
    expect(link).toContain(first.shareId);
    const second = await buildShare({ folderName: "B", withAnnotations: false, papers: [{ metadata: paper("a"), pdf: pdf(1) }] });
    await uploadShare({ share: second, relayUrl, backend: remote.backend, registry, logger });
    expect(remote.puts).toHaveLength(1);
    expect([...remote.manifests.keys()].sort()).toEqual([first.shareId, second.shareId].sort());
    const listed = await loadShareRegistry(registry);
    expect(listed.shares[0]).toEqual({
      id: first.shareId, folder: "A", relayUrl, key: expect.any(String), createdAt: "1970-01-01T00:00:00.000Z", blobs: [first.blobs[0]!.hash],
    });
  });

  it("revoke keeps the blobs another share uses and deletes the rest", async () => {
    const remote = memoryBackend();
    const registry = memoryStore();
    const shared = await buildShare({ folderName: "A", withAnnotations: false, papers: [{ metadata: paper("a"), pdf: pdf(1) }, { metadata: paper("b"), pdf: pdf(2) }] });
    const other = await buildShare({ folderName: "B", withAnnotations: false, papers: [{ metadata: paper("a"), pdf: pdf(1) }] });
    await uploadShare({ share: shared, relayUrl, backend: remote.backend, registry, logger });
    await uploadShare({ share: other, relayUrl, backend: remote.backend, registry, logger });

    expect(await revokeShare(shared.shareId, { registry, backendFor: () => remote.backend, logger })).toBe(true);

    expect([...remote.manifests.keys()]).toEqual([other.shareId]);
    expect([...remote.blobs.keys()]).toEqual([other.blobs[0]!.hash]);
    expect((await loadShareRegistry(registry)).shares.map((share) => share.id)).toEqual([other.shareId]);
    expect(await revokeShare(shared.shareId, { registry, backendFor: () => remote.backend, logger })).toBe(false);
  });

  it("keeps the share listed when a delete fails, so revoking again finishes", async () => {
    const remote = memoryBackend();
    const registry = memoryStore();
    const share = await buildShare({ folderName: "A", withAnnotations: false, papers: [{ metadata: paper("a"), pdf: pdf(1) }] });
    await uploadShare({ share, relayUrl, backend: remote.backend, registry, logger });
    const failing: ShareBackend = { ...remote.backend, deleteBlob: async () => { throw new Error("offline"); } };
    await expect(revokeShare(share.shareId, { registry, backendFor: () => failing, logger })).rejects.toThrow("offline");
    expect((await loadShareRegistry(registry)).shares).toHaveLength(1);
    expect(await revokeShare(share.shareId, { registry, backendFor: () => remote.backend, logger })).toBe(true);
    expect(remote.blobs.size).toBe(0);
  });

  it("revokes what a failed upload wrote", async () => {
    const remote = memoryBackend();
    const registry = memoryStore();
    const share = await buildShare({ folderName: "A", withAnnotations: false, papers: [{ metadata: paper("a"), pdf: pdf(1) }] });
    const failing: ShareBackend = { ...remote.backend, putManifest: async () => { throw new Error("quota"); } };
    await expect(uploadShare({ share, relayUrl, backend: failing, registry, logger })).rejects.toThrow("quota");
    expect(remote.blobs.size).toBe(0);
    expect((await loadShareRegistry(registry)).shares).toEqual([]);
  });

  it("never overwrites an unreadable share list", async () => {
    const registry = memoryStore("{not json");
    const share = await buildShare({ folderName: "A", withAnnotations: false, papers: [{ metadata: paper("a") }] });
    await expect(uploadShare({ share, relayUrl, backend: memoryBackend().backend, registry, logger })).rejects.toThrow(/share list/);
    expect(registry.text).toBe("{not json");
  });

  it("drops a malformed entry and keeps the others", async () => {
    const good = { id: "0123456789abcdef0123456789abcdef", folder: "A", relayUrl, key: "AAAAAAAAAAAAAAAAAAAAAA", createdAt: "x", blobs: [] };
    const registry = memoryStore(JSON.stringify({ shares: [good, { ...good, id: 3 }] }));
    expect((await loadShareRegistry(registry)).shares).toEqual([good]);
  });
});
