/** Pins the deck share: the deck manifest sealed apart from the paper manifest, building and uploading a deck in convergent parts, openAnyShare over paper and deck links, the registry's kind, and that paper shares behave as before. */
import {
  buildDeckShare,
  decodeDeckShareManifest,
  openAnyShare,
  openDeckManifest,
  sealDeckManifest,
  uploadDeckShare,
  type BuiltDeckShare,
  type DeckShareManifest,
} from "../../src/share/deckShare";
import {
  buildShare,
  decodeShareManifest,
  formatShareLink,
  loadShareRegistry,
  openShare,
  openShareBlob,
  openShareManifest,
  removeShare,
  sealShareBlob,
  sealShareManifest,
  uploadShare,
  type ShareBackend,
  type ShareManifest,
  type ShareReader,
  type ShareRegistryStore,
  type SharedPdfPart,
} from "../../src/share/index";
import type { ILogger } from "../../src/ports/index";
import { memoryShareRegistry, memoryShareRelay } from "../support/memoryShareRelay";

const relayUrl = "https://relay.someone.workers.dev";
const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const shareId = "0123456789abcdef0123456789abcdef";
const linkKey = new Uint8Array(16).map((_, index) => index + 1);
const utf8 = (text: string) => new TextEncoder().encode(text);

/** An ASCII deck HTML of exactly `length` bytes. */
function deckHtml(length: number, seed = 0): string {
  const head = "<!doctype html><html data-deck=\"talk\">";
  let body = "";
  for (let index = 0; body.length < length - head.length; index += 1) { body += String.fromCharCode(97 + ((index * 7 + seed) % 26)); }
  return (head + body).slice(0, length);
}

async function manifestOf(html: string, extra: Partial<DeckShareManifest> = {}): Promise<DeckShareManifest> {
  const sealed = await sealShareBlob(utf8(html));
  return { v: 1, kind: "deck", title: "My talk", deck: "talk", size: "1920x1080px", bytes: sealed.part.size, parts: [sealed.part], ...extra };
}

function readerOfDeck(share: BuiltDeckShare, sealedManifest: Uint8Array): ShareReader & { blobs: Map<string, Uint8Array> } {
  const blobs = new Map(share.blobs.map((blob) => [blob.name, blob.bytes]));
  return {
    blobs,
    fetchManifest: async (id) => (id === share.shareId ? sealedManifest : undefined),
    fetchBlob: async (_id, hash) => blobs.get(hash),
  };
}

const linkOf = (share: { key: Uint8Array }) => formatShareLink({ relayUrl, key: share.key });

async function uploadedDeck(html: string, partBytes?: number) {
  const remote = memoryShareRelay();
  const registry = memoryShareRegistry();
  const share = await buildDeckShare({ title: "My talk", deck: "talk", size: "1920x1080px", html, ...(partBytes ? { partLimits: { partBytes } } : {}) });
  const link = await uploadDeckShare({ share, relayUrl, backend: remote.backend, registry, logger, now: () => new Date(0) });
  return { remote, registry, share, link };
}

async function openDeck(link: string, reader: ShareReader) {
  const result = await openAnyShare(link, (url) => {
    expect(url).toBe(relayUrl);
    return reader;
  });
  if (!result.ok) { throw new Error(`open failed: ${result.error}`); }
  if (result.opened.kind !== "deck") { throw new Error(`opened as ${result.opened.kind}`); }
  return result.opened;
}

const paperRecord = { id: "vaswani2017attention", title: "Attention Is All You Need", citeKey: "vaswani2017attention", authors: ["Ashish Vaswani"], year: 2017 };
const pdfBytes = (length: number, seed: number) => new Uint8Array(length).map((_, index) => (index * 31 + seed) % 251);

describe("deck manifest", () => {
  it("10.1a seals and opens a deck manifest round trip", async () => {
    const manifest = await manifestOf(deckHtml(500));
    const sealed = await sealDeckManifest(linkKey, shareId, manifest);
    expect(new TextDecoder().decode(sealed)).not.toContain("My talk");
    expect(await openDeckManifest(linkKey, shareId, sealed)).toEqual(manifest);
  });

  it("10.1a does not open a deck manifest under another key or share id", async () => {
    const sealed = await sealDeckManifest(linkKey, shareId, await manifestOf(deckHtml(200)));
    expect(await openDeckManifest(new Uint8Array(16).fill(9), shareId, sealed)).toBeUndefined();
    expect(await openDeckManifest(linkKey, "fedcba9876543210fedcba9876543210", sealed)).toBeUndefined();
  });

  it("10.1a does not open a deck manifest as a paper manifest", async () => {
    const sealed = await sealDeckManifest(linkKey, shareId, await manifestOf(deckHtml(200)));
    expect(await openShareManifest(linkKey, shareId, sealed)).toBeUndefined();
  });

  it("10.1a does not open a paper manifest as a deck manifest", async () => {
    const paper: ShareManifest = { v: 1, folder: "Reading group", papers: [{ metadata: { id: "a", title: "A", citeKey: "a" } }] };
    const sealed = await sealShareManifest(linkKey, shareId, paper);
    expect(await openDeckManifest(linkKey, shareId, sealed)).toBeUndefined();
  });

  it("10.1a decodes a valid talk and poster manifest and drops unknown fields", async () => {
    const talk = await manifestOf(deckHtml(300));
    expect(decodeDeckShareManifest(talk)).toEqual(talk);
    const poster = await manifestOf(deckHtml(300), { deck: "poster", size: "841x1189mm", title: "Poster" });
    expect(decodeDeckShareManifest(poster)).toEqual(poster);
    expect(decodeDeckShareManifest({ ...talk, extra: "dropped" })).toEqual(talk);
  });

  it("10.1a rejects malformed deck manifests", async () => {
    const valid = await manifestOf(deckHtml(300));
    const part = valid.parts[0] as SharedPdfPart;
    const malformed: unknown[] = [
      null,
      "deck",
      [],
      { ...valid, v: 2 },
      { ...valid, v: "1" },
      { ...valid, kind: "folder" },
      { ...valid, kind: undefined },
      { ...valid, title: 3 },
      { ...valid, title: undefined },
      { ...valid, deck: "slides" },
      { ...valid, deck: undefined },
      { ...valid, size: "1920x1080" },
      { ...valid, size: "10x10px" },
      { ...valid, size: 1920 },
      { ...valid, bytes: -1 },
      { ...valid, bytes: 1.5 },
      { ...valid, bytes: "300" },
      { ...valid, bytes: 301 },
      { ...valid, parts: "none" },
      { ...valid, parts: [part, part] },
      { ...valid, parts: undefined },
    ];
    for (const value of malformed) {
      expect([value, decodeDeckShareManifest(value)]).toEqual([value, undefined]);
    }
  });
});

describe("buildDeckShare", () => {
  it("10.1b splits the HTML into parts of at most partBytes that openShareBlob opens back into the HTML", async () => {
    const html = deckHtml(2500, 1);
    const share = await buildDeckShare({ title: "My talk", deck: "talk", size: "1920x1080px", html, partLimits: { partBytes: 1000 } });
    expect(share.manifest).toMatchObject({ v: 1, kind: "deck", title: "My talk", deck: "talk", size: "1920x1080px", bytes: 2500 });
    expect(share.manifest.parts.map((part) => part.size)).toEqual([1000, 1000, 500]);
    const byName = new Map(share.blobs.map((blob) => [blob.name, blob.bytes]));
    const chunks: Uint8Array[] = [];
    for (const part of share.manifest.parts) {
      const opened = await openShareBlob(part, byName.get(part.blob)!);
      expect(opened).toBeDefined();
      chunks.push(opened!);
    }
    const joined = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
    expect(new TextDecoder().decode(joined)).toBe(html);
  });

  it("10.1b counts bytes as the UTF-8 size of the HTML", async () => {
    const html = "<html data-deck=\"poster\">Café — Größe ∑</html>";
    const share = await buildDeckShare({ title: "Poster", deck: "poster", size: "841x1189mm", html });
    expect(share.manifest.bytes).toBe(utf8(html).length);
    expect(share.manifest.parts.reduce((sum, part) => sum + part.size, 0)).toBe(utf8(html).length);
  });

  it("10.1b keeps a small HTML in one part by default", async () => {
    const share = await buildDeckShare({ title: "T", deck: "talk", size: "1920x1080px", html: deckHtml(5000) });
    expect(share.manifest.parts).toHaveLength(1);
    expect(share.blobs).toHaveLength(1);
    expect(share.blobs[0]!.name).toBe(share.manifest.parts[0]!.blob);
  });

  it("10.1b stores the same HTML as the same blobs in every share, under a fresh share id and key", async () => {
    const html = deckHtml(2200, 2);
    const first = await buildDeckShare({ title: "A", deck: "talk", size: "1920x1080px", html, partLimits: { partBytes: 1000 } });
    const second = await buildDeckShare({ title: "B", deck: "talk", size: "1440x1080px", html, partLimits: { partBytes: 1000 } });
    expect(second.blobs.map((blob) => blob.name)).toEqual(first.blobs.map((blob) => blob.name));
    expect(second.manifest.parts).toEqual(first.manifest.parts);
    expect(first.shareId).toMatch(/^[0-9a-f]{32}$/);
    expect(second.shareId).not.toBe(first.shareId);
    expect(first.key).toHaveLength(16);
    expect(Buffer.from(second.key).equals(Buffer.from(first.key))).toBe(false);
  });

  it("10.1b gives a manifest that decodeDeckShareManifest accepts unchanged", async () => {
    const share = await buildDeckShare({ title: "T", deck: "talk", size: "1920x1080px", html: deckHtml(2100), partLimits: { partBytes: 700 } });
    expect(decodeDeckShareManifest(JSON.parse(JSON.stringify(share.manifest)))).toEqual(share.manifest);
  });
});

describe("uploadDeckShare", () => {
  it("10.1b lists the share with kind deck and returns its link", async () => {
    const { registry, share, link } = await uploadedDeck(deckHtml(2500), 1000);
    expect(link).toBe(linkOf(share));
    expect((await loadShareRegistry(registry)).shares).toEqual([{
      id: share.shareId, folder: "My talk", relayUrl, key: expect.any(String), createdAt: "1970-01-01T00:00:00.000Z",
      blobs: share.blobs.map((blob) => blob.name), kind: "deck",
    }]);
  });

  it("10.1b writes the registry entry first, then the blobs, then the manifest", async () => {
    const remote = memoryShareRelay();
    const registry = memoryShareRegistry();
    const events: string[] = [];
    const listedAtFirstBlob: unknown[] = [];
    const recording: ShareRegistryStore = {
      read: () => registry.read(),
      write: async (text) => { events.push("registry"); await registry.write(text); },
      exclusive: (run) => registry.exclusive(run),
    };
    const backend: ShareBackend = {
      ...remote.backend,
      putBlob: async (id, hash, bytes) => {
        if (!events.includes("blob")) { listedAtFirstBlob.push(...(await loadShareRegistry(registry)).shares); }
        events.push("blob");
        await remote.backend.putBlob(id, hash, bytes);
      },
      putManifest: async (id, bytes) => { events.push("manifest"); await remote.backend.putManifest(id, bytes); },
    };
    const share = await buildDeckShare({ title: "My talk", deck: "talk", size: "1920x1080px", html: deckHtml(2500), partLimits: { partBytes: 1000 } });
    await uploadDeckShare({ share, relayUrl, backend, registry: recording, logger });
    expect(events).toEqual(["registry", "blob", "blob", "blob", "manifest"]);
    expect(listedAtFirstBlob).toEqual([expect.objectContaining({ id: share.shareId, kind: "deck" })]);
  });

  it("10.1b stores a manifest that opens as the deck manifest under the link key", async () => {
    const { remote, share } = await uploadedDeck(deckHtml(1500), 1000);
    expect(await openDeckManifest(share.key, share.shareId, remote.manifests.get(share.shareId)!)).toEqual(share.manifest);
    expect([...remote.blobs.keys()].sort()).toEqual(share.blobs.map((blob) => blob.name).sort());
  });

  it("10.1b revokes what a failed upload wrote", async () => {
    const remote = memoryShareRelay();
    const registry = memoryShareRegistry();
    const share = await buildDeckShare({ title: "T", deck: "talk", size: "1920x1080px", html: deckHtml(2500), partLimits: { partBytes: 1000 } });
    const failing: ShareBackend = { ...remote.backend, putManifest: async () => { throw new Error("quota"); } };
    await expect(uploadDeckShare({ share, relayUrl, backend: failing, registry, logger })).rejects.toThrow("quota");
    expect(remote.blobs.size).toBe(0);
    expect((await loadShareRegistry(registry)).shares).toEqual([]);
  });
});

describe("openAnyShare", () => {
  it("10.1c opens a paper link as a folder exactly as openShare does", async () => {
    const pdf = pdfBytes(1000, 1);
    const paper = await buildShare({ folderName: "Reading group", withAnnotations: false, papers: [{ metadata: paperRecord, bib: "@article{x}", pdf }] });
    const reader: ShareReader = {
      fetchManifest: async (id) => (id === paper.shareId ? paper.sealedManifest : undefined),
      fetchBlob: async (_id, hash) => paper.blobs.find((blob) => blob.hash === hash)?.bytes,
    };
    const viaShare = await openShare(linkOf(paper), () => reader);
    const viaAny = await openAnyShare(linkOf(paper), (url) => { expect(url).toBe(relayUrl); return reader; });
    if (!viaShare.ok || !viaAny.ok || viaAny.opened.kind !== "folder") { throw new Error("open failed"); }
    expect(viaAny.opened.share.link).toEqual(viaShare.share.link);
    expect(viaAny.opened.share.manifest).toEqual(viaShare.share.manifest);
    const first = viaShare.share.manifest.papers[0]!;
    expect(await viaAny.opened.share.loadPdf(first)).toEqual({ ok: true, bytes: pdf });
  });

  it("10.1c opens a deck link as a deck whose loadHtml returns the HTML", async () => {
    const html = deckHtml(2500, 3);
    const { remote, share, link } = await uploadedDeck(html, 1000);
    const opened = await openDeck(link, remote.reader);
    expect(opened.manifest).toEqual(share.manifest);
    expect(opened.link).toEqual({ relayUrl, shareId: share.shareId, key: share.key });
    expect(await opened.loadHtml()).toEqual({ ok: true, html });
  });

  it("10.1c returns non-ASCII HTML intact across part boundaries", async () => {
    const html = `<html>${"é∑".repeat(400)}</html>`;
    const { remote, link } = await uploadedDeck(html, 333);
    expect(await (await openDeck(link, remote.reader)).loadHtml()).toEqual({ ok: true, html });
  });

  it("10.1c reports removed after removeShare", async () => {
    const { remote, registry, share, link } = await uploadedDeck(deckHtml(800));
    expect(await removeShare(share.shareId, { registry, backendFor: () => remote.backend, logger })).toBe(true);
    expect(await openAnyShare(link, () => remote.reader)).toEqual({ ok: false, error: "removed" });
  });

  it("10.1c reports a malformed link, a network failure and a wrong key", async () => {
    const { remote, share } = await uploadedDeck(deckHtml(800));
    expect(await openAnyShare("https://labshelf.app/s/#nope", () => remote.reader)).toEqual({ ok: false, error: "malformedLink" });
    const down: ShareReader = { fetchManifest: async () => { throw new Error("offline"); }, fetchBlob: async () => undefined };
    expect(await openAnyShare(linkOf(share), () => down)).toMatchObject({ ok: false, error: "network", detail: expect.stringContaining("offline") });
    const wrongKey = formatShareLink({ relayUrl, key: new Uint8Array(16).fill(9) });
    // The other key derives another share id, which the Worker does not hold.
    expect(await openAnyShare(wrongKey, () => remote.reader)).toEqual({ ok: false, error: "removed" });
  });

  it("10.1c loadHtml reports a tampered, a missing and an unreachable part", async () => {
    const html = deckHtml(2500, 4);
    const share = await buildDeckShare({ title: "T", deck: "talk", size: "1920x1080px", html, partLimits: { partBytes: 1000 } });
    const reader = readerOfDeck(share, await sealDeckManifest(share.key, share.shareId, share.manifest));
    const opened = await openDeck(linkOf(share), reader);
    const [first, second] = share.blobs;
    const flipped = first!.bytes.slice();
    flipped[flipped.length - 1] = flipped[flipped.length - 1]! ^ 1;
    reader.blobs.set(first!.name, flipped);
    expect(await opened.loadHtml()).toMatchObject({ ok: false, error: "tampered" });
    reader.blobs.set(first!.name, second!.bytes);
    expect(await opened.loadHtml()).toMatchObject({ ok: false, error: "tampered" });
    reader.blobs.delete(first!.name);
    expect(await opened.loadHtml()).toMatchObject({ ok: false, error: "missing" });
    const down = await openDeck(linkOf(share), { ...reader, fetchBlob: async () => { throw new Error("offline"); } });
    expect(await down.loadHtml()).toMatchObject({ ok: false, error: "network", detail: expect.stringContaining("offline") });
  });
});

describe("paper shares are unchanged", () => {
  it("10.1d a paper share built, uploaded and opened with the existing functions gives the same manifest and PDFs", async () => {
    const remote = memoryShareRelay();
    const registry = memoryShareRegistry();
    const pdf = pdfBytes(2500, 7);
    const share = await buildShare({
      folderName: "Reading group", withAnnotations: false, partLimits: { maxBlobBytes: 1100, partBytes: 1000 },
      papers: [{ metadata: { ...paperRecord, status: "reading", tags: ["mine"] } as typeof paperRecord, bib: "@article{x}", pdf }, { metadata: { id: "b", title: "B", citeKey: "b" } }],
    });
    const link = await uploadShare({ share, relayUrl, backend: remote.backend, registry, logger, now: () => new Date(0) });
    const opened = await openShare(link, () => remote.reader);
    if (!opened.ok) { throw new Error(opened.error); }
    expect(opened.share.manifest).toEqual({
      v: 1, folder: "Reading group",
      papers: [
        { metadata: paperRecord, bib: "@article{x}", pdf: { size: 2500, parts: share.manifest.papers[0]!.pdf!.parts } },
        { metadata: { id: "b", title: "B", citeKey: "b" } },
      ],
    });
    expect(share.manifest.papers[0]!.pdf!.parts.map((part) => part.size)).toEqual([1000, 1000, 500]);
    expect(await opened.share.loadPdf(opened.share.manifest.papers[0]!)).toEqual({ ok: true, bytes: pdf });
    expect(await opened.share.loadPdf(opened.share.manifest.papers[1]!)).toEqual({ ok: false, error: "noPdf" });
    expect((await loadShareRegistry(registry)).shares).toEqual([{
      id: share.shareId, folder: "Reading group", relayUrl, key: expect.any(String), createdAt: "1970-01-01T00:00:00.000Z", blobs: share.blobs.map((blob) => blob.hash),
    }]);
  });

  it("10.1d decodeShareManifest gives the same results for a fixed table of values", async () => {
    const part = (await sealShareBlob(pdfBytes(100, 1))).part;
    const meta = { id: "a", title: "A", citeKey: "a" };
    const table: [unknown, unknown][] = [
      [null, undefined],
      ["manifest", undefined],
      [{ v: 2, folder: "F", papers: [] }, undefined],
      [{ v: 1, folder: 3, papers: [] }, undefined],
      [{ v: 1, folder: "F" }, undefined],
      [{ v: 1, kind: "deck", title: "T", deck: "talk", size: "1920x1080px", bytes: 100, parts: [part] }, undefined],
      [{ v: 1, folder: "F", papers: [] }, { v: 1, folder: "F", papers: [] }],
      [{ v: 1, folder: "F", papers: [], kind: "deck", extra: 1 }, { v: 1, folder: "F", papers: [] }],
      [{ v: 1, folder: "F", papers: [{ metadata: { ...meta, status: "reading", tags: ["x"], year: 2020 } }] }, { v: 1, folder: "F", papers: [{ metadata: { ...meta, year: 2020 } }] }],
      [{ v: 1, folder: "F", papers: [{ metadata: { id: "x" } }, { metadata: meta }, 5] }, { v: 1, folder: "F", papers: [{ metadata: meta }] }],
      [{ v: 1, folder: "F", papers: [{ metadata: meta, bib: "@b", pdf: { size: 100, parts: [part] } }] }, { v: 1, folder: "F", papers: [{ metadata: meta, bib: "@b", pdf: { size: 100, parts: [part] } }] }],
      [{ v: 1, folder: "F", papers: [{ metadata: meta, pdf: { size: 101, parts: [part] } }] }, { v: 1, folder: "F", papers: [{ metadata: meta }] }],
      [{ v: 1, folder: "F", papers: [{ metadata: meta, pdf: { size: 0, parts: [] } }] }, { v: 1, folder: "F", papers: [{ metadata: meta }] }],
      [{ v: 1, folder: "F", papers: [{ metadata: meta, pdf: { size: 100, parts: [{ ...part, blob: "nothex" }] } }] }, { v: 1, folder: "F", papers: [{ metadata: meta }] }],
    ];
    for (const [value, expected] of table) {
      expect([value, decodeShareManifest(value)]).toEqual([value, expected]);
    }
  });

  it("10.1d openShare of a deck link answers unreadable", async () => {
    const { remote, link } = await uploadedDeck(deckHtml(900));
    expect(await openShare(link, () => remote.reader)).toEqual({ ok: false, error: "unreadable" });
  });

  it("10.1d the registry keeps kind deck and drops any other kind", async () => {
    const base = { relayUrl, key: "AAAAAAAAAAAAAAAAAAAAAA", createdAt: "x", blobs: [] as string[] };
    const deck = { ...base, id: "00000000000000000000000000000001", folder: "Talk", kind: "deck" };
    const folder = { ...base, id: "00000000000000000000000000000002", folder: "F", kind: "folder" };
    const numeric = { ...base, id: "00000000000000000000000000000003", folder: "N", kind: 3 };
    const plain = { ...base, id: "00000000000000000000000000000004", folder: "P" };
    const registry = memoryShareRegistry(JSON.stringify({ shares: [deck, folder, numeric, plain] }));
    const folderWithout = { ...base, id: folder.id, folder: folder.folder };
    const numericWithout = { ...base, id: numeric.id, folder: numeric.folder };
    const shares = (await loadShareRegistry(registry)).shares;
    expect(shares).toEqual([deck, folderWithout, numericWithout, plain]);
    expect(shares.map((share) => "kind" in share)).toEqual([true, false, false, false]);
  });

  it("10.1d the registry keeps a deck's kind when a paper upload rewrites the list", async () => {
    const { remote, registry, share } = await uploadedDeck(deckHtml(600));
    const paper = await buildShare({ folderName: "F", withAnnotations: false, papers: [{ metadata: { id: "a", title: "A", citeKey: "a" } }] });
    await uploadShare({ share: paper, relayUrl, backend: remote.backend, registry, logger });
    const shares = (await loadShareRegistry(registry)).shares;
    expect(shares.find((entry) => entry.id === share.shareId)).toMatchObject({ kind: "deck" });
    expect("kind" in shares.find((entry) => entry.id === paper.shareId)!).toBe(false);
  });
});

describe("A8 a deck shared by link", () => {
  it("A8 opens through openAnyShare, revoking makes it unreadable, and existing paper links keep working", async () => {
    const remote = memoryShareRelay();
    const registry = memoryShareRegistry();
    const pdf = pdfBytes(700, 9);
    const paper = await buildShare({ folderName: "Papers", withAnnotations: false, papers: [{ metadata: paperRecord, pdf }] });
    const paperLink = await uploadShare({ share: paper, relayUrl, backend: remote.backend, registry, logger });
    const html = deckHtml(3000, 5);
    const deck = await buildDeckShare({ title: "Talk", deck: "talk", size: "1920x1080px", html, partLimits: { partBytes: 1000 } });
    const deckLink = await uploadDeckShare({ share: deck, relayUrl, backend: remote.backend, registry, logger });

    expect(await (await openDeck(deckLink, remote.reader)).loadHtml()).toEqual({ ok: true, html });

    expect(await removeShare(deck.shareId, { registry, backendFor: () => remote.backend, logger })).toBe(true);
    const revoked = await openAnyShare(deckLink, () => remote.reader);
    expect(revoked.ok).toBe(false);
    expect([...remote.blobs.keys()]).toEqual(paper.blobs.map((blob) => blob.hash));

    const viaShare = await openShare(paperLink, () => remote.reader);
    if (!viaShare.ok) { throw new Error(viaShare.error); }
    expect(await viaShare.share.loadPdf(viaShare.share.manifest.papers[0]!)).toEqual({ ok: true, bytes: pdf });
    const viaAny = await openAnyShare(paperLink, () => remote.reader);
    if (!viaAny.ok || viaAny.opened.kind !== "folder") { throw new Error("paper link did not open as a folder"); }
    expect(viaAny.opened.share.manifest).toEqual(paper.manifest);
  });
});
