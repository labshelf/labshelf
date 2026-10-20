// Pins how changed one-page PDFs from the helper merge into the previous whole PDF.
import { PDFDocument } from "pdf-lib";
import { assemblePdf } from "../../../src/library-page/preview";

// Page width encodes identity, so each assembled page can be traced to its source.
async function onePage(width: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([width, 100]);
  return doc.save();
}

async function widths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => p.getWidth());
}

async function pages(...ws: number[]) {
  return Promise.all(ws.map(async (w, index) => ({ index, bytes: await onePage(w) })));
}

describe("assemblePdf", () => {
  it("joins every page when there is no previous PDF", async () => {
    const changed = await pages(101, 102, 103);
    const out = await assemblePdf(undefined, { pageCount: 3, changed: [changed[2]!, changed[0]!, changed[1]!] });
    expect(await widths(out)).toEqual([101, 102, 103]);
  });

  it("replaces only the changed page and keeps the others", async () => {
    const first = await assemblePdf(undefined, { pageCount: 3, changed: await pages(101, 102, 103) });
    const out = await assemblePdf(first, { pageCount: 3, changed: [{ index: 1, bytes: await onePage(202) }] });
    expect(await widths(out)).toEqual([101, 202, 103]);
  });

  it("drops the pages past pageCount", async () => {
    const first = await assemblePdf(undefined, { pageCount: 3, changed: await pages(101, 102, 103) });
    const out = await assemblePdf(first, { pageCount: 2, changed: [] });
    expect(await widths(out)).toEqual([101, 102]);
  });

  it("adds pages that the previous PDF did not have", async () => {
    const first = await assemblePdf(undefined, { pageCount: 1, changed: await pages(101) });
    const out = await assemblePdf(first, { pageCount: 2, changed: [{ index: 1, bytes: await onePage(302) }] });
    expect(await widths(out)).toEqual([101, 302]);
  });

  it("rejects a result that leaves a page with no bytes", async () => {
    await expect(assemblePdf(undefined, { pageCount: 2, changed: await pages(101) })).rejects.toThrow(/page 2/);
  });
});


it("reuses the PDF when no page or page count changed", async () => {
  const first = await assemblePdf(undefined, { pageCount: 2, changed: await pages(101, 102) });
  expect(await assemblePdf(first, { pageCount: 2, changed: [] })).toBe(first);
});
