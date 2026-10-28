/** Pins building and opening a share (manifest round trip, the annotations choice, split PDFs, tampered blobs) and upload and revoke against the device's share list (blob reuse, cleanup of a failed upload, blobs other shares keep, concurrent edits). */
import type { Annotation, PaperRecord } from "../../src/model/index";
import {
  buildShare,
  formatShareLink,
  openShare,
  type BuiltShare,
  type ShareReader,
  loadShareRegistry,
  removeShare,
  uploadShare,
  type ShareBackend,
  type ShareRegistryStore,
} from "../../src/share/index";
import type { ILogger } from "../../src/ports/index";
import { memoryShareRegistry, memoryShareRelay } from "../support/memoryShareRelay";

const relayUrl = "https://relay.someone.workers.dev";

const record: PaperRecord = {
  id: "vaswani2017attention", title: "Attention Is All You Need", citeKey: "vaswani2017attention", path: "papers/x",
  status: "reading", tags: ["mine"], note: "private", authors: ["Ashish Vaswani"], year: 2017, doi: "10.48550/arXiv.1706.03762",
};
const annotation: Annotation = {
  id: "a1", paperId: record.id, type: "highlight", pageNumber: 3, content: "key idea", color: "yellow",
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
};

function pdfBytes(length: number, seed: number): Uint8Array {
  return new Uint8Array(length).map((_, index) => (index * 31 + seed) % 251);
}

function readerOf(share: BuiltShare): ShareReader & { blobs: Map<string, Uint8Array> } {
  const blobs = new Map(share.blobs.map((blob) => [blob.hash, blob.bytes]));
  return {
    blobs,
    fetchManifest: async (id) => (id === share.shareId ? share.sealedManifest : undefined),
    fetchBlob: async (_id, hash) => blobs.get(hash),
  };
}

async function open(share: BuiltShare, reader: ShareReader = readerOf(share)) {
  const opened = await openShare(formatShareLink({ relayUrl, shareId: share.shareId, key: share.key }), (url) => {
    expect(url).toBe(relayUrl);
    return reader;
  });
  if (!opened.ok) { throw new Error(`open failed: ${opened.error}`); }
  return opened.share;
}

describe("buildShare and openShare", () => {
  it("round trips the manifest without the user's own fields", async () => {
    const pdf = pdfBytes(1000, 1);
    const share = await buildShare({
      folderName: "Reading group", withAnnotations: false,
      papers: [{ metadata: record, bib: "@article{vaswani2017attention}", pdf, annotations: [annotation] }, { metadata: { id: "b", title: "B", citeKey: "b" } }],
    });
    const opened = await open(share);
    expect(opened.manifest.folder).toBe("Reading group");
    expect(opened.manifest.papers[0]!.metadata).toEqual({
      id: record.id, title: record.title, citeKey: record.citeKey, authors: record.authors, year: 2017, doi: record.doi,
    });
    expect(opened.manifest.papers[0]!.bib).toBe("@article{vaswani2017attention}");
    expect(opened.manifest.papers[0]!.annotations).toBeUndefined();
    expect(opened.manifest.papers[1]!.pdf).toBeUndefined();
    expect(await opened.loadPdf(opened.manifest.papers[0]!)).toEqual({ ok: true, bytes: pdf });
    expect(await opened.loadPdf(opened.manifest.papers[1]!)).toEqual({ ok: false, error: "noPdf" });
  });

  it("carries the annotations only when the sharer chose them", async () => {
    const share = await buildShare({ folderName: "F", withAnnotations: true, papers: [{ metadata: record, annotations: [annotation] }] });
    expect((await open(share)).manifest.papers[0]!.annotations).toEqual([annotation]);
  });

  it("keeps the manifest unreadable without the link key", async () => {
    const share = await buildShare({ folderName: "Secret folder", withAnnotations: false, papers: [{ metadata: record }] });
    expect(new TextDecoder().decode(share.sealedManifest)).not.toContain("Secret folder");
    const otherKey = new Uint8Array(16).fill(9);
    const result = await openShare(formatShareLink({ relayUrl, shareId: share.shareId, key: otherKey }), () => readerOf(share));
    expect(result).toEqual({ ok: false, error: "unreadable" });
  });

  it("splits a PDF over the blob limit into parts and reassembles it", async () => {
    const pdf = pdfBytes(2500, 2);
    const small = pdfBytes(300, 3);
    const share = await buildShare({
      folderName: "F", withAnnotations: false, partLimits: { maxBlobBytes: 1100, partBytes: 1000 },
      papers: [{ metadata: record, pdf }, { metadata: { id: "s", title: "S", citeKey: "s" }, pdf: small }],
    });
    const opened = await open(share);
    expect(opened.manifest.papers[0]!.pdf!.parts.map((part) => part.size)).toEqual([1000, 1000, 500]);
    expect(opened.manifest.papers[1]!.pdf!.parts).toHaveLength(1);
    expect(share.blobs).toHaveLength(4);
    expect(await opened.loadPdf(opened.manifest.papers[0]!)).toEqual({ ok: true, bytes: pdf });
  });

  it("stores the same PDF as the same blob in every share", async () => {
    const pdf = pdfBytes(800, 4);
    const first = await buildShare({ folderName: "A", withAnnotations: false, papers: [{ metadata: record, pdf }] });
    const second = await buildShare({ folderName: "B", withAnnotations: true, papers: [{ metadata: record, pdf }, { metadata: { id: "c", title: "C", citeKey: "c" }, pdf }] });
    expect(second.blobs.map((blob) => blob.hash)).toEqual(first.blobs.map((blob) => blob.hash));
    expect(second.shareId).not.toBe(first.shareId);
  });

  it("rejects a tampered or swapped blob", async () => {
    const share = await buildShare({
      folderName: "F", withAnnotations: false,
      papers: [{ metadata: record, pdf: pdfBytes(600, 5) }, { metadata: { id: "o", title: "O", citeKey: "o" }, pdf: pdfBytes(600, 6) }],
    });
    const reader = readerOf(share);
    const opened = await open(share, reader);
    const [first, second] = share.blobs;
    const flipped = first!.bytes.slice();
    flipped[flipped.length - 1] = flipped[flipped.length - 1]! ^ 1;
    reader.blobs.set(first!.hash, flipped);
    expect(await opened.loadPdf(opened.manifest.papers[0]!)).toEqual({ ok: false, error: "tampered" });
    reader.blobs.set(first!.hash, second!.bytes);
    expect(await opened.loadPdf(opened.manifest.papers[0]!)).toEqual({ ok: false, error: "tampered" });
    reader.blobs.delete(first!.hash);
    expect(await opened.loadPdf(opened.manifest.papers[0]!)).toEqual({ ok: false, error: "missing" });
  });

  it("names a removed share and a malformed link", async () => {
    const share = await buildShare({ folderName: "F", withAnnotations: false, papers: [{ metadata: record }] });
    const gone: ShareReader = { fetchManifest: async () => undefined, fetchBlob: async () => undefined };
    expect(await openShare(formatShareLink({ relayUrl, shareId: share.shareId, key: share.key }), () => gone)).toEqual({ ok: false, error: "removed" });
    expect(await openShare("https://labshelf.app/share/#nope", () => gone)).toEqual({ ok: false, error: "malformedLink" });
    const down: ShareReader = { fetchManifest: async () => { throw new Error("offline"); }, fetchBlob: async () => undefined };
    expect(await openShare(formatShareLink({ relayUrl, shareId: share.shareId, key: share.key }), () => down)).toMatchObject({ ok: false, error: "network", detail: expect.stringContaining("offline") });
  });
});

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
