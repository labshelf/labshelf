/** Pins upload and revoke against the device's share list: blob reuse, cleanup of a failed upload, blobs other shares keep and concurrent edits. */
import type { ILogger } from "../../src/ports/index";
import {
  buildShare, loadShareRegistry, removeShare, uploadShare, type ShareBackend, type ShareRegistryStore,
} from "../../src/share/index";
import { memoryShareRegistry, memoryShareRelay } from "../support/memoryShareRelay";

const relayUrl = "https://relay.someone.workers.dev";
const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const paper = (id: string) => ({ id, title: id, citeKey: id });
const pdf = (seed: number) => new Uint8Array(400).fill(seed);

const listedIds = async (registry: ShareRegistryStore) => (await loadShareRegistry(registry)).shares.map((share) => share.id);
const twoPdfs = () => buildShare({ folderName: "A", withAnnotations: false, papers: [{ metadata: paper("a"), pdf: pdf(1) }, { metadata: paper("b"), pdf: pdf(2) }] });

describe("uploadShare and revokeShare", () => {
  it("uploads blobs once, the manifest, and lists the share", async () => {
    const remote = memoryShareRelay();
    const registry = memoryShareRegistry();
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
    const remote = memoryShareRelay();
    const registry = memoryShareRegistry();
    const shared = await buildShare({ folderName: "A", withAnnotations: false, papers: [{ metadata: paper("a"), pdf: pdf(1) }, { metadata: paper("b"), pdf: pdf(2) }] });
    const other = await buildShare({ folderName: "B", withAnnotations: false, papers: [{ metadata: paper("a"), pdf: pdf(1) }] });
    await uploadShare({ share: shared, relayUrl, backend: remote.backend, registry, logger });
    await uploadShare({ share: other, relayUrl, backend: remote.backend, registry, logger });

    expect(await removeShare(shared.shareId, { registry, backendFor: () => remote.backend, logger })).toBe(true);

    expect([...remote.manifests.keys()]).toEqual([other.shareId]);
    expect([...remote.blobs.keys()]).toEqual([other.blobs[0]!.hash]);
    expect((await loadShareRegistry(registry)).shares.map((share) => share.id)).toEqual([other.shareId]);
    expect(await removeShare(shared.shareId, { registry, backendFor: () => remote.backend, logger })).toBe(false);
  });

  it("keeps the share listed when a delete fails, so revoking again finishes", async () => {
    const remote = memoryShareRelay();
    const registry = memoryShareRegistry();
    const share = await buildShare({ folderName: "A", withAnnotations: false, papers: [{ metadata: paper("a"), pdf: pdf(1) }] });
    await uploadShare({ share, relayUrl, backend: remote.backend, registry, logger });
    const failing: ShareBackend = { ...remote.backend, deleteBlob: async () => { throw new Error("offline"); } };
    await expect(removeShare(share.shareId, { registry, backendFor: () => failing, logger })).rejects.toThrow("offline");
    expect((await loadShareRegistry(registry)).shares).toHaveLength(1);
    expect(await removeShare(share.shareId, { registry, backendFor: () => remote.backend, logger })).toBe(true);
    expect(remote.blobs.size).toBe(0);
  });

  it("revokes what a failed upload wrote", async () => {
    const remote = memoryShareRelay();
    const registry = memoryShareRegistry();
    const share = await buildShare({ folderName: "A", withAnnotations: false, papers: [{ metadata: paper("a"), pdf: pdf(1) }] });
    const failing: ShareBackend = { ...remote.backend, putManifest: async () => { throw new Error("quota"); } };
    await expect(uploadShare({ share, relayUrl, backend: failing, registry, logger })).rejects.toThrow("quota");
    expect(remote.blobs.size).toBe(0);
    expect((await loadShareRegistry(registry)).shares).toEqual([]);
  });

  it("never overwrites an unreadable share list", async () => {
    const registry = memoryShareRegistry("{not json");
    const share = await buildShare({ folderName: "A", withAnnotations: false, papers: [{ metadata: paper("a") }] });
    await expect(uploadShare({ share, relayUrl, backend: memoryShareRelay().backend, registry, logger })).rejects.toThrow(/share list/);
    expect(registry.text).toBe("{not json");
  });

  it("drops a malformed entry and keeps the others", async () => {
    const good = { id: "0123456789abcdef0123456789abcdef", folder: "A", relayUrl, key: "AAAAAAAAAAAAAAAAAAAAAA", createdAt: "x", blobs: [] };
    const registry = memoryShareRegistry(JSON.stringify({ shares: [good, { ...good, id: 3 }] }));
    expect((await loadShareRegistry(registry)).shares).toEqual([good]);
  });

  it("revokes what an upload interrupted between blobs wrote", async () => {
    const remote = memoryShareRelay();
    const registry = memoryShareRegistry();
    const share = await twoPdfs();
    let puts = 0;
    const failing: ShareBackend = { ...remote.backend, putBlob: async (id, hash, bytes) => {
      if (++puts === 2) { throw new Error("connection reset"); }
      await remote.backend.putBlob(id, hash, bytes);
    } };
    await expect(uploadShare({ share, relayUrl, backend: failing, registry, logger })).rejects.toThrow("connection reset");
    expect(remote.blobs.size).toBe(0);
    expect(await listedIds(registry)).toEqual([]);
  });

  it("keeps an interrupted upload listed when its cleanup fails too, and a restarted device revokes it", async () => {
    const remote = memoryShareRelay();
    const registry = memoryShareRegistry();
    const share = await twoPdfs();
    const offline: ShareBackend = {
      ...remote.backend,
      putBlob: async (id, hash, bytes) => { await remote.backend.putBlob(id, hash, bytes); throw new Error("offline"); },
      deleteManifest: async () => { throw new Error("offline"); },
    };
    await expect(uploadShare({ share, relayUrl, backend: offline, registry, logger })).rejects.toThrow("offline");
    expect(await listedIds(registry)).toEqual([share.shareId]);
    expect(remote.blobs.size).toBe(1);

    const restarted = memoryShareRegistry(registry.text);
    expect(await removeShare(share.shareId, { registry: restarted, backendFor: () => remote.backend, logger })).toBe(true);
    expect(remote.blobs.size).toBe(0);
    expect(await listedIds(restarted)).toEqual([]);
  });

  it("never overwrites an unreadable share list on revoke", async () => {
    const registry = memoryShareRegistry('{"shares": 3}');
    await expect(removeShare("0123456789abcdef0123456789abcdef", { registry, backendFor: () => memoryShareRelay().backend, logger }))
      .rejects.toThrow(/share list/);
    expect(registry.text).toBe('{"shares": 3}');
  });

  it("keeps both of two uploads that run at once", async () => {
    const remote = memoryShareRelay();
    const registry = memoryShareRegistry();
    const [a, b] = await Promise.all([twoPdfs(), twoPdfs()]);
    await Promise.all([a, b].map((share) => uploadShare({ share, relayUrl, backend: remote.backend, registry, logger })));
    expect((await listedIds(registry)).sort()).toEqual([a.shareId, b.shareId].sort());
  });

  it("keeps a share uploaded while a revoke is deleting", async () => {
    const remote = memoryShareRelay();
    const registry = memoryShareRegistry();
    const doomed = await buildShare({ folderName: "A", withAnnotations: false, papers: [{ metadata: paper("a"), pdf: pdf(1) }] });
    const added = await buildShare({ folderName: "B", withAnnotations: false, papers: [{ metadata: paper("b"), pdf: pdf(2) }] });
    await uploadShare({ share: doomed, relayUrl, backend: remote.backend, registry, logger });
    let release!: () => void;
    let deleting!: () => void;
    const started = new Promise<void>((resolve) => { deleting = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow: ShareBackend = { ...remote.backend, deleteManifest: async (id) => { deleting(); await gate; await remote.backend.deleteManifest(id); } };
    const revoking = removeShare(doomed.shareId, { registry, backendFor: () => slow, logger });
    await started;
    await uploadShare({ share: added, relayUrl, backend: remote.backend, registry, logger });
    release();
    expect(await revoking).toBe(true);
    expect(await listedIds(registry)).toEqual([added.shareId]);
    expect([...remote.manifests.keys()]).toEqual([added.shareId]);
  });
});
