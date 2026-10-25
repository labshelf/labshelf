/** Verifies that comparePages reports only the pages of a PDF whose content changed since the last call. */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { comparePages } from "../../../src/helper/node/comparePages";

async function makePdf(texts: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of texts) { doc.addPage([200, 200]).drawText(text, { x: 20, y: 100, size: 12, font }); }
  return doc.save();
}

describe("comparePages", () => {
  it("marks every page changed on the first call and returns one-page PDFs", async () => {
    const result = await comparePages([], await makePdf(["one", "two", "three"]));
    expect(result.pageCount).toBe(3);
    expect(result.hashes).toHaveLength(3);
    expect(result.changed.map((page) => page.index)).toEqual([0, 1, 2]);
    for (const page of result.changed) {
      expect(Buffer.from(page.bytes.subarray(0, 5)).toString()).toBe("%PDF-");
      expect((await PDFDocument.load(page.bytes)).getPageCount()).toBe(1);
    }
  });

  it("returns only the page whose text changed", async () => {
    const first = await comparePages([], await makePdf(["one", "two", "three"]));
    const second = await comparePages(first.hashes, await makePdf(["one", "TWO", "three"]));
    expect(second.pageCount).toBe(3);
    expect(second.changed.map((page) => page.index)).toEqual([1]);
    expect(second.hashes[0]).toBe(first.hashes[0]);
    expect(second.hashes[1]).not.toBe(first.hashes[1]);
  });

  it("returns nothing when the PDF is the same", async () => {
    const pdf = await makePdf(["one", "two"]);
    const first = await comparePages([], pdf);
    expect((await comparePages(first.hashes, pdf)).changed).toEqual([]);
  });

  it("drops the page count when pages disappear and reports no changed page for the removed ones", async () => {
    const first = await comparePages([], await makePdf(["one", "two", "three"]));
    const second = await comparePages(first.hashes, await makePdf(["one", "two"]));
    expect(second.pageCount).toBe(2);
    expect(second.hashes).toHaveLength(2);
    expect(second.changed).toEqual([]);
  });

  it("reports added pages as changed", async () => {
    const first = await comparePages([], await makePdf(["one"]));
    const second = await comparePages(first.hashes, await makePdf(["one", "two"]));
    expect(second.pageCount).toBe(2);
    expect(second.changed.map((page) => page.index)).toEqual([1]);
  });
});
