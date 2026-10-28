import { writeImportedPaper } from "@labshelf/core";

import { makeHarness, PAPERS, pdfBytes } from "../../support/mutationHarness";

const log = { message: "Paper captured", context: { page: "https://pub.example/a" } };
const metadata = { title: "Self-Attention at Scale", authors: ["Ann Lee"], year: 2020, journal: "J. Things" };

describe("writeImportedPaper", () => {
  it("stores the title as given with the user's tags, and the PDF when there is one", async () => {
    const h = makeHarness();

    const record = await writeImportedPaper(h.ctx, [], PAPERS, { metadata, pdf: pdfBytes(), extra: { tags: ["NLP"] }, log });

    expect(record).toEqual({
      id: "lee2020selfattention", citeKey: "lee2020selfattention", path: `${PAPERS}/lee2020selfattention`, status: "unread", hasPdf: true,
      title: "Self-Attention at Scale", authors: ["Ann Lee"], year: 2020, journal: "J. Things", tags: ["NLP"],
    });
    expect(await h.readMeta(record.path)).toMatchObject({ title: "Self-Attention at Scale", source: "paper.pdf" });
    expect(h.logs.find((l) => l.message === "Paper captured")).toMatchObject({ context: { page: "https://pub.example/a", id: "lee2020selfattention", withPdf: true } });
  });

  it("writes only the metadata files for a paper without a PDF", async () => {
    const h = makeHarness();

    const record = await writeImportedPaper(h.ctx, [], PAPERS, { metadata, log });

    expect(record.hasPdf).toBe(false);
    expect(h.fs.fileList().filter((f) => f.startsWith(`${record.path}/`))).toEqual([`${record.path}/bib.bib`, `${record.path}/metadata.yaml`]);
  });

  it("skips an id taken in another casing and a folder that exists without a known paper", async () => {
    const h = makeHarness();
    await h.fs.mkdir(`${PAPERS}/lee2020selfattentiona`);

    const record = await writeImportedPaper(h.ctx, ["Lee2020SelfAttention"], PAPERS, { metadata, log });

    expect(record.id).toBe("lee2020selfattentionb");
  });

  it("writes the PDF's version beside the PDF", async () => {
    const h = makeHarness();

    const record = await writeImportedPaper(h.ctx, [], PAPERS, { metadata, pdf: pdfBytes(), pdfVersion: "accepted", log });

    expect(await h.readMeta(record.path)).toMatchObject({ pdfVersion: "accepted" });
    expect(h.logs.find((l) => l.message === "Paper captured")).toMatchObject({ context: { pdfVersion: "accepted" } });
  });

  it("writes no version without a PDF, or for a PDF of unknown version", async () => {
    const h = makeHarness();

    const noPdf = await writeImportedPaper(h.ctx, [], PAPERS, { metadata, pdfVersion: "preprint", log });
    const unlabelled = await writeImportedPaper(h.ctx, [noPdf.id], PAPERS, { metadata, pdf: pdfBytes(), log });

    expect(await h.readMeta(noPdf.path)).not.toHaveProperty("pdfVersion");
    expect(await h.readMeta(unlabelled.path)).not.toHaveProperty("pdfVersion");
  });
});
