// Hidden tests of spec 10c.3: addPrintMarks over real pdf-lib PDFs, POSTER_PDF_CHOICES, and exportDeckPdf with the marks option.
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { PDFDocument, rgb } from "pdf-lib";

import { addPrintMarks, POSTER_PDF_CHOICES } from "../../src/decks/deckPrintMarks.js";
import { exportDeckPdf } from "../../src/decks/node/printPdf.js";
import type { CancellableOptions, RunOutcome } from "../../src/latex/node/index.js";
import type { ILogger } from "../../src/ports/index.js";

const MM = 72 / 25.4;
// A0 portrait in points.
const A0: [number, number] = [841 * MM, 1189 * MM];
const HTML = "<!doctype html><html><body><section>Poster</section></body></html>";

async function makePdf(sizes: Array<[number, number]>): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (const [w, h] of sizes) {
    const page = doc.addPage([w, h]);
    page.drawRectangle({ x: 10, y: 10, width: w / 2, height: h / 2, color: rgb(0.2, 0.4, 0.8) });
  }
  return doc.save();
}

interface Box { x: number; y: number; width: number; height: number }

function expectBox(actual: Box, x: number, y: number, width: number, height: number): void {
  expect(actual.x).toBeCloseTo(x, 2);
  expect(actual.y).toBeCloseTo(y, 2);
  expect(actual.width).toBeCloseTo(width, 2);
  expect(actual.height).toBeCloseTo(height, 2);
}

function makeLogger(): ILogger & { log: jest.Mock; error: jest.Mock } {
  return { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
}

function fakeRun(pdf: Uint8Array) {
  return async (_e: string, args: string[], _cwd: string, _signal: AbortSignal, _options?: CancellableOptions): Promise<RunOutcome> => {
    const target = args.find((arg) => arg.startsWith("--print-to-pdf="));
    if (target) { await fs.writeFile(target.slice("--print-to-pdf=".length), pdf); }
    return { code: 0, output: "" };
  };
}

let root: string;

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "labshelf-printmarks-")));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("addPrintMarks", () => {
  it("10c.3a 3 mm bleed makes the page 6 mm larger each way", async () => {
    const out = await addPrintMarks(await makePdf([A0]), { bleedMm: 3, cropMarks: false });
    const page = (await PDFDocument.load(out)).getPage(0);
    const { width, height } = page.getSize();
    expect(width).toBeCloseTo(A0[0] + 6 * MM, 2);
    expect(height).toBeCloseTo(A0[1] + 6 * MM, 2);
  });

  it("10c.3a 3 mm bleed puts TrimBox at the bleed offset and BleedBox on the whole page", async () => {
    const out = await addPrintMarks(await makePdf([A0]), { bleedMm: 3, cropMarks: false });
    const page = (await PDFDocument.load(out)).getPage(0);
    const b = 3 * MM;
    expectBox(page.getTrimBox(), b, b, A0[0], A0[1]);
    expectBox(page.getBleedBox(), 0, 0, A0[0] + 2 * b, A0[1] + 2 * b);
  });

  it("10c.3a MediaBox and CropBox are the whole page", async () => {
    const out = await addPrintMarks(await makePdf([A0]), { bleedMm: 3, cropMarks: true });
    const page = (await PDFDocument.load(out)).getPage(0);
    const m = 8 * MM;
    expectBox(page.getMediaBox(), 0, 0, A0[0] + 2 * m, A0[1] + 2 * m);
    expectBox(page.getCropBox(), 0, 0, A0[0] + 2 * m, A0[1] + 2 * m);
  });

  it("10c.3a bleed with crop marks makes the page larger by 2 x (3 + 5) mm", async () => {
    const out = await addPrintMarks(await makePdf([A0]), { bleedMm: 3, cropMarks: true });
    const { width, height } = (await PDFDocument.load(out)).getPage(0).getSize();
    expect(width).toBeCloseTo(A0[0] + 16 * MM, 2);
    expect(height).toBeCloseTo(A0[1] + 16 * MM, 2);
  });

  it("10c.3a bleed with crop marks puts TrimBox at 8 mm and BleedBox 3 mm around it", async () => {
    const out = await addPrintMarks(await makePdf([A0]), { bleedMm: 3, cropMarks: true });
    const page = (await PDFDocument.load(out)).getPage(0);
    const m = 8 * MM;
    const b = 3 * MM;
    expectBox(page.getTrimBox(), m, m, A0[0], A0[1]);
    expectBox(page.getBleedBox(), m - b, m - b, A0[0] + 2 * b, A0[1] + 2 * b);
  });

  it("10c.3a crop marks without bleed add 8 mm around the trim and the BleedBox equals the TrimBox", async () => {
    const out = await addPrintMarks(await makePdf([A0]), { bleedMm: 0, cropMarks: true });
    const page = (await PDFDocument.load(out)).getPage(0);
    const m = 8 * MM;
    expect(page.getSize().width).toBeCloseTo(A0[0] + 2 * m, 2);
    expect(page.getSize().height).toBeCloseTo(A0[1] + 2 * m, 2);
    expectBox(page.getTrimBox(), m, m, A0[0], A0[1]);
    expectBox(page.getBleedBox(), m, m, A0[0], A0[1]);
  });

  it("10c.3a a bleed above 3 mm moves the crop marks outside the bleed", async () => {
    const out = await addPrintMarks(await makePdf([A0]), { bleedMm: 5, cropMarks: true });
    const page = (await PDFDocument.load(out)).getPage(0);
    const b = 5 * MM;
    const m = 10 * MM;
    expect(page.getSize().width).toBeCloseTo(A0[0] + 2 * m, 2);
    expectBox(page.getTrimBox(), m, m, A0[0], A0[1]);
    expectBox(page.getBleedBox(), m - b, m - b, A0[0] + 2 * b, A0[1] + 2 * b);
  });

  it("10c.3a a multi-page source keeps its page count and each page's size and offsets", async () => {
    const sizes: Array<[number, number]> = [[300, 400], [500, 200], [250, 250]];
    const out = await addPrintMarks(await makePdf(sizes), { bleedMm: 3, cropMarks: false });
    const doc = await PDFDocument.load(out);
    const b = 3 * MM;
    expect(doc.getPageCount()).toBe(3);
    sizes.forEach(([w, h], i) => {
      const page = doc.getPage(i);
      expect(page.getSize().width).toBeCloseTo(w + 2 * b, 2);
      expect(page.getSize().height).toBeCloseTo(h + 2 * b, 2);
      expectBox(page.getTrimBox(), b, b, w, h);
    });
  });

  it("10c.3a the same input gives the same bytes twice", async () => {
    const source = await makePdf([A0, [300, 400]]);
    const first = await addPrintMarks(source, { bleedMm: 3, cropMarks: true });
    const second = await addPrintMarks(source, { bleedMm: 3, cropMarks: true });
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it("10c.3b bleed 0 without marks returns the same bytes", async () => {
    const source = await makePdf([A0, [300, 400]]);
    const out = await addPrintMarks(source, { bleedMm: 0, cropMarks: false });
    expect(Buffer.from(out).equals(Buffer.from(source))).toBe(true);
  });

  it.each([[-1], [-0.01], [20.01], [21], [Number.NaN], [Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY]])(
    "10c.3b throws RangeError for bleed %p",
    async (bleedMm) => {
      const source = await makePdf([[300, 400]]);
      await expect(addPrintMarks(source, { bleedMm, cropMarks: false })).rejects.toBeInstanceOf(RangeError);
    },
  );

  it("10c.3b throws RangeError for a bad bleed even with crop marks", async () => {
    const source = await makePdf([[300, 400]]);
    await expect(addPrintMarks(source, { bleedMm: 25, cropMarks: true })).rejects.toBeInstanceOf(RangeError);
  });

  it("10c.3b accepts the bounds 0 with marks and 20", async () => {
    const source = await makePdf([[300, 400]]);
    const marks = await addPrintMarks(source, { bleedMm: 0, cropMarks: true });
    expect((await PDFDocument.load(marks)).getPageCount()).toBe(1);
    const max = await addPrintMarks(source, { bleedMm: 20, cropMarks: false });
    const page = (await PDFDocument.load(max)).getPage(0);
    expect(page.getSize().width).toBeCloseTo(300 + 40 * MM, 2);
  });
});

describe("POSTER_PDF_CHOICES", () => {
  it("10c.3c lists the three choices in order", () => {
    expect(POSTER_PDF_CHOICES).toEqual([
      { label: "PDF", detail: "Trim size, as built", marks: null },
      { label: "PDF with 3 mm bleed", detail: "For printers that trim", marks: { bleedMm: 3, cropMarks: false } },
      { label: "PDF with 3 mm bleed and crop marks", detail: "For printers that ask for marks", marks: { bleedMm: 3, cropMarks: true } },
    ]);
  });
});

describe("exportDeckPdf with marks", () => {
  const find = async () => ({ path: "/fake/chrome", source: "system" as const });

  it("10c.3d with marks writes a PDF whose page carries the TrimBox", async () => {
    const printed = await makePdf([[400, 600]]);
    const out = path.join(root, "poster.pdf");
    const result = await exportDeckPdf(HTML, { out, find, run: fakeRun(printed), logger: makeLogger(), marks: { bleedMm: 3, cropMarks: false } });
    expect(result).toEqual({ kind: "pdf", path: out });
    const page = (await PDFDocument.load(await fs.readFile(out))).getPage(0);
    const b = 3 * MM;
    expectBox(page.getTrimBox(), b, b, 400, 600);
    expect(page.getSize().width).toBeCloseTo(400 + 2 * b, 2);
  });

  it("10c.3d without marks writes the printed bytes as before", async () => {
    const printed = await makePdf([[400, 600]]);
    const out = path.join(root, "poster.pdf");
    await exportDeckPdf(HTML, { out, find, run: fakeRun(printed), logger: makeLogger() });
    expect((await fs.readFile(out)).equals(Buffer.from(printed))).toBe(true);
  });

  it("10c.3d with marks null writes the printed bytes", async () => {
    const printed = await makePdf([[400, 600]]);
    const out = path.join(root, "poster.pdf");
    await exportDeckPdf(HTML, { out, find, run: fakeRun(printed), logger: makeLogger(), marks: null } as never);
    expect((await fs.readFile(out)).equals(Buffer.from(printed))).toBe(true);
  });

  it("10c.3d the print fallback ignores marks", async () => {
    const out = path.join(root, "poster.pdf");
    const result = await exportDeckPdf(HTML, { out, find: async () => undefined, logger: makeLogger(), marks: { bleedMm: 3, cropMarks: true } });
    expect(result.kind).toBe("fallback");
    expect(await fs.readFile(path.join(root, "poster.html"), "utf8")).toBe(HTML);
  });
});

describe("poster PDF export", () => {
  it("A10 the bleed and crop marks choice exports a poster PDF with trim, bleed and mark margins", async () => {
    const choice = POSTER_PDF_CHOICES[2];
    expect(choice?.marks).toEqual({ bleedMm: 3, cropMarks: true });
    const printed = await makePdf([A0]);
    const out = path.join(root, "poster.pdf");
    const find = async () => ({ path: "/fake/chrome", source: "system" as const });
    const result = await exportDeckPdf(HTML, { out, find, run: fakeRun(printed), logger: makeLogger(), marks: choice?.marks ?? undefined });
    expect(result).toEqual({ kind: "pdf", path: out });
    const page = (await PDFDocument.load(await fs.readFile(out))).getPage(0);
    const m = 8 * MM;
    const b = 3 * MM;
    expect(page.getSize().width).toBeCloseTo(A0[0] + 2 * m, 2);
    expectBox(page.getTrimBox(), m, m, A0[0], A0[1]);
    expectBox(page.getBleedBox(), m - b, m - b, A0[0] + 2 * b, A0[1] + 2 * b);
  });
});
