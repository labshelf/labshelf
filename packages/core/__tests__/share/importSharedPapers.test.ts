/** Verifies that a share's papers land in a fresh library folder, skipping papers the library already holds. */
import { importSharedPapers, type OpenedShare, type SharedPaper } from "../../src/share/index";
import { makeHarness, PAPERS, pdfBytes } from "../support/mutationHarness";

function paper(id: string, extra: Partial<SharedPaper["metadata"]> = {}, pdf = true): SharedPaper {
  const shared: SharedPaper = { metadata: { id, title: `Title ${id}`, citeKey: id, ...extra } };
  if (pdf) { shared.pdf = { size: 1, parts: [] }; }
  return shared;
}

function openedShare(folder: string, papers: SharedPaper[], missing: string[] = []): OpenedShare {
  return {
    link: { relayUrl: "https://r.example.workers.dev", shareId: "a".repeat(32), key: new Uint8Array(16) },
    manifest: { v: 1, folder, papers },
    loadPdf: (shared) => Promise.resolve(
      !shared.pdf ? { ok: false, error: "noPdf" } : missing.includes(shared.metadata.id) ? { ok: false, error: "missing" } : { ok: true, bytes: pdfBytes(shared.metadata.id) },
    ),
  };
}

describe("importSharedPapers", () => {
  it("writes each paper with its PDF and bibliographic fields into a folder named after the share", async () => {
    const h = makeHarness();
    const share = openedShare("Reading group", [paper("vaswani2017", { authors: ["Ashish Vaswani"], year: 2017 }), paper("nopdf", {}, false)]);
    const summary = await importSharedPapers({ ctx: h.ctx, share, parentDir: PAPERS, known: [] });
    expect(summary.folder).toBe(`${PAPERS}/Reading group`);
    expect(summary.added.map((r) => r.id)).toEqual(["vaswani2017", "nopdf"]);
    expect(await h.readMeta(`${PAPERS}/Reading group/vaswani2017`)).toMatchObject({ title: "Title vaswani2017", authors: ["Ashish Vaswani"], year: 2017 });
    expect(new TextDecoder().decode(await h.fs.readFile(`${PAPERS}/Reading group/vaswani2017/paper.pdf`))).toContain("vaswani2017");
    expect(await h.fs.exists(`${PAPERS}/Reading group/nopdf/paper.pdf`)).toBe(false);
  });

  it("suffixes a folder name the library already uses, and replaces a name a folder cannot take", async () => {
    const h = makeHarness();
    await h.fs.mkdir(`${PAPERS}/Reading group`);
    await h.fs.mkdir(`${PAPERS}/Reading group 2`);
    expect((await importSharedPapers({ ctx: h.ctx, share: openedShare("Reading group", [paper("a")]), parentDir: PAPERS, known: [] })).folder)
      .toBe(`${PAPERS}/Reading group 3`);
    expect((await importSharedPapers({ ctx: h.ctx, share: openedShare("../evil", [paper("b")]), parentDir: PAPERS, known: [] })).folder)
      .toBe(`${PAPERS}/Shared papers`);
  });

  it("skips a paper whose DOI or arXiv id the library holds, and one listed twice in the share", async () => {
    const h = makeHarness();
    const known = [{ id: "mine", doi: "10.1234/ABC" }, { id: "preprint", url: "https://arxiv.org/abs/1706.03762v2" }];
    const share = openedShare("Group", [
      paper("x", { doi: "10.1234/abc" }), paper("y", { doi: "10.48550/arXiv.1706.03762" }), paper("z", { doi: "10.5678/z" }), paper("z2", { doi: "10.5678/Z" }),
    ]);
    const summary = await importSharedPapers({ ctx: h.ctx, share, parentDir: PAPERS, known });
    expect(summary.added.map((r) => r.id)).toEqual(["z"]);
    expect(summary.duplicates).toEqual([{ title: "Title x", existingId: "mine" }, { title: "Title y", existingId: "preprint" }, { title: "Title z2", existingId: "z" }]);
  });

  it("claims a free cite key and keeps only key characters of an untrusted one", async () => {
    const h = makeHarness();
    const summary = await importSharedPapers({ ctx: h.ctx, share: openedShare("G", [paper("../../x y"), paper("x/y")]), parentDir: PAPERS, known: [{ id: "xy" }] });
    expect(summary.added.map((r) => r.id)).toEqual(["xya", "xyb"]);
  });

  it("imports a paper whose PDF cannot be read without its PDF, and names it", async () => {
    const h = makeHarness();
    const summary = await importSharedPapers({ ctx: h.ctx, share: openedShare("G", [paper("gone")], ["gone"]), parentDir: PAPERS, known: [] });
    expect(summary.added[0]?.hasPdf).toBe(false);
    expect(summary.missingPdfs).toEqual(["Title gone"]);
  });

  it("creates no folder when every paper is already in the library", async () => {
    const h = makeHarness();
    const summary = await importSharedPapers({ ctx: h.ctx, share: openedShare("G", [paper("x", { doi: "10.1234/a" })]), parentDir: PAPERS, known: [{ id: "x", doi: "10.1234/a" }] });
    expect(summary.folder).toBeUndefined();
    expect(await h.fs.exists(`${PAPERS}/G`)).toBe(false);
  });
});
