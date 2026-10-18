/** Pins building and opening a share: manifest round trip, the annotations choice, split PDFs and tampered blobs. */
import type { Annotation, PaperRecord } from "../../src/model/index";
import { buildShare, formatShareLink, openShare, type BuiltShare, type ShareReader } from "../../src/share/index";

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
