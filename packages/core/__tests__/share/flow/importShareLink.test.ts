/** Pins importing a share link: a refused or unopenable link writes nothing, duplicates are skipped, unreadable PDFs are counted. */
import type { Annotation } from "../../../src/model/index";
import { buildShare, formatShareLink, importShareLink, type ShareReader } from "../../../src/share/index";
import { makeHarness, PAPERS, pdfBytes } from "../../support/mutationHarness";
import { memoryShareRelay } from "../../support/memoryShareRelay";

const relayUrl = "https://relay.someone.workers.dev";
const annotation = { id: "n1", paperId: "dup", type: "note", pageNumber: 1, content: "x" } as Annotation;
const meta = (id: string, doi?: string) => ({ id, title: `Title ${id}`, citeKey: id, ...(doi ? { doi } : {}) });

async function published() {
  const relay = memoryShareRelay();
  const share = await buildShare({
    folderName: "Group", withAnnotations: true,
    papers: [
      { metadata: meta("dup", "10.1234/dup"), pdf: pdfBytes("dup"), annotations: [annotation] },
      { metadata: meta("fine"), pdf: pdfBytes("fine") },
      { metadata: meta("gone"), pdf: pdfBytes("gone") },
      { metadata: meta("damaged"), pdf: pdfBytes("damaged") },
    ],
  });
  for (const blob of share.blobs) { await relay.backend.putBlob(share.shareId, blob.hash, blob.bytes); }
  await relay.backend.putManifest(share.shareId, share.sealedManifest);
  const [, , gone, damaged] = share.blobs;
  relay.blobs.delete(gone!.hash);
  relay.blobs.set(damaged!.hash, new Uint8Array(damaged!.bytes.length).fill(9));
  return { relay, share, link: formatShareLink({ relayUrl, shareId: share.shareId, key: share.key }) };
}

describe("importShareLink", () => {
  it("refuses a link that does not parse and writes nothing", async () => {
    const h = makeHarness();
    const result = await importShareLink({ text: "https://labshelf.org/share/#nope", ctx: h.ctx, parentDir: PAPERS, known: [], readerFor: () => memoryShareRelay().reader });
    expect(result).toEqual({ status: "refused", error: expect.any(String) });
    expect(await h.fs.listDir(PAPERS)).toEqual([]);
  });

  it("names why a revoked link does not open", async () => {
    const h = makeHarness();
    const { link } = await published();
    const empty: ShareReader = memoryShareRelay().reader;
    expect(await importShareLink({ text: link, ctx: h.ctx, parentDir: PAPERS, known: [], readerFor: () => empty }))
      .toEqual({ status: "openFailed", error: "removed" });
    expect(h.logs.some((log) => log.level === "WARN" && log.context?.["error"] === "removed")).toBe(true);
  });

  it("skips a paper the library holds and imports the others, counting the PDFs it could not read", async () => {
    const h = makeHarness();
    const { relay, link } = await published();
    const result = await importShareLink({ text: link, ctx: h.ctx, parentDir: PAPERS, known: [{ id: "mine", doi: "10.1234/DUP" }], readerFor: () => relay.reader });
    if (result.status !== "imported") { throw new Error(`import failed: ${result.status}`); }
    expect(result.withAnnotations).toBe(true);
    expect(result.summary.folder).toBe(`${PAPERS}/Group`);
    expect(result.summary.added.map((paper) => paper.id)).toEqual(["fine", "gone", "damaged"]);
    expect(result.summary.duplicates).toEqual([{ title: "Title dup", existingId: "mine" }]);
    expect(result.summary.missingPdfs).toEqual(["Title gone", "Title damaged"]);
    expect(await h.fs.exists(`${PAPERS}/Group/fine/paper.pdf`)).toBe(true);
  });
});
