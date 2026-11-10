// Hidden tests of spec 11.2: TALK_PDF_CHOICES, readPdfPageLabels and layoutTalkPdf over real pdf-lib PDFs.
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream, PDFString, rgb } from "pdf-lib";

import {
  layoutTalkPdf,
  readPdfPageLabels,
  TALK_PDF_CHOICES,
  type TalkPdfLayout,
} from "../../src/decks/deckHandout.js";

const A4_W = 595.28;
const A4_H = 841.89;

interface Range { start: number; style?: string; st?: number; prefix?: string }

function rangeDict(doc: PDFDocument, r: Range) {
  const entries: Record<string, unknown> = {};
  if (r.style) { entries.S = r.style; }
  if (r.st !== undefined) { entries.St = r.st; }
  const dict = doc.context.obj(entries as never) as unknown as PDFDict;
  if (r.prefix !== undefined) { dict.set(PDFName.of("P"), PDFString.of(r.prefix)); }
  return dict;
}

function nums(doc: PDFDocument, ranges: Range[]) {
  const arr: unknown[] = [];
  for (const r of ranges) { arr.push(r.start, rangeDict(doc, r)); }
  return doc.context.obj({ Nums: arr } as never);
}

/** A PDF of `pages` 400x300 pages; `labels` sets one decimal range per page with the given numbers. */
async function makePdf(pages: number, labels?: number[] | Range[], nested = false): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([400, 300]);
    page.drawRectangle({ x: 20, y: 20, width: 200, height: 100, color: rgb(0.2, 0.4, 0.8) });
  }
  if (labels) {
    const ranges: Range[] = labels.map((l, i) => (typeof l === "number" ? { start: i, style: "D", st: l } : l));
    let tree = nums(doc, ranges);
    if (nested) { tree = doc.context.obj({ Kids: [doc.context.register(tree)] } as never); }
    doc.catalog.set(PDFName.of("PageLabels"), tree);
  }
  return doc.save();
}

async function sizes(pdf: Uint8Array): Promise<Array<{ width: number; height: number }>> {
  const doc = await PDFDocument.load(pdf);
  return doc.getPages().map((p) => p.getSize());
}

function expectA4(all: Array<{ width: number; height: number }>): void {
  for (const s of all) {
    expect(s.width).toBeCloseTo(A4_W, 1);
    expect(s.height).toBeCloseTo(A4_H, 1);
  }
}

/** Text strings (hex or literal) drawn on one page's own content stream, concatenated. */
async function sheetText(pdf: Uint8Array, index: number): Promise<string> {
  const doc = await PDFDocument.load(pdf);
  const page = doc.getPage(index);
  const contents = page.node.Contents();
  const refs: unknown[] = contents instanceof PDFArray ? contents.asArray() : [contents];
  let out = "";
  for (const item of refs) {
    const obj = item instanceof PDFRef ? doc.context.lookup(item) : item;
    if (obj instanceof PDFRawStream) {
      out += Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1");
    } else if (obj instanceof PDFStream) {
      out += Buffer.from(obj.getContents()).toString("latin1");
    }
  }
  let text = "";
  for (const m of out.matchAll(/<([0-9A-Fa-f\s]+)>|\(((?:[^()\\]|\\.)*)\)/g)) {
    if (m[1] !== undefined) {
      const hex = m[1].replace(/\s+/g, "");
      for (let i = 0; i + 1 < hex.length; i += 2) { text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16)); }
    } else if (m[2] !== undefined) {
      text += m[2];
    }
  }
  return text;
}

async function allText(pdf: Uint8Array): Promise<string> {
  const count = (await PDFDocument.load(pdf)).getPageCount();
  const parts: string[] = [];
  for (let i = 0; i < count; i++) { parts.push(await sheetText(pdf, i)); }
  return parts.join("\n");
}

const NO_NOTES = { notes: [] as string[] };

describe("TALK_PDF_CHOICES", () => {
  it("A11 has the six entries in order", () => {
    expect(TALK_PDF_CHOICES.map((c) => c.label)).toEqual([
      "PDF",
      "Handout, 2 per page",
      "Handout, 3 per page",
      "Handout, 4 per page",
      "Handout, 6 per page",
      "Notes pages",
    ]);
  });

  it("A11 the first choice has layout null and the rest carry their layouts", () => {
    expect(TALK_PDF_CHOICES[0].layout).toBeNull();
    expect(TALK_PDF_CHOICES[0].detail).toBe("One slide per page");
    expect(TALK_PDF_CHOICES.slice(1).map((c) => c.layout)).toEqual([
      { kind: "handout", perPage: 2 },
      { kind: "handout", perPage: 3 },
      { kind: "handout", perPage: 4 },
      { kind: "handout", perPage: 6 },
      { kind: "notes" },
    ]);
  });

  it("A11 the fixed details read as specified", () => {
    expect(TALK_PDF_CHOICES[1].detail).toBe("Two slides per A4 page");
    expect(TALK_PDF_CHOICES[2].detail).toBe("Three slides per A4 page with lines for notes");
    expect(TALK_PDF_CHOICES[5].detail).toBe("Each slide above its speaker notes");
  });
});

describe("readPdfPageLabels", () => {
  it("A11 returns the decimal labels of a /PageLabels tree", async () => {
    expect(await readPdfPageLabels(await makePdf(4, [1, 2, 2, 3]))).toEqual(["1", "2", "2", "3"]);
  });

  it("A11 returns null when the PDF has no /PageLabels", async () => {
    expect(await readPdfPageLabels(await makePdf(3))).toBeNull();
  });

  it("A11 a range numbers its following pages consecutively from /St", async () => {
    const pdf = await makePdf(3, [{ start: 0, style: "D", st: 5 }]);
    expect(await readPdfPageLabels(pdf)).toEqual(["5", "6", "7"]);
  });

  it("A11 applies the /P prefix to decimal labels", async () => {
    const pdf = await makePdf(2, [{ start: 0, style: "D", st: 1, prefix: "A-" }]);
    expect(await readPdfPageLabels(pdf)).toEqual(["A-1", "A-2"]);
  });

  it("A11 a non-decimal style gives the prefix alone", async () => {
    const pdf = await makePdf(2, [{ start: 0, style: "R", st: 1, prefix: "x" }]);
    expect(await readPdfPageLabels(pdf)).toEqual(["x", "x"]);
  });

  it("A11 follows /Kids to nested number trees", async () => {
    const pdf = await makePdf(4, [1, 2, 2, 3], true);
    expect(await readPdfPageLabels(pdf)).toEqual(["1", "2", "2", "3"]);
  });
});

describe("layoutTalkPdf handouts", () => {
  const cases: Array<[2 | 3 | 4 | 6, number]> = [[2, 3], [3, 2], [4, 2], [6, 1]];
  for (const [perPage, sheets] of cases) {
    it(`A11 a 5-page PDF without labels at ${perPage} per page gives ${sheets} A4 portrait sheets`, async () => {
      const out = await layoutTalkPdf(await makePdf(5), { kind: "handout", perPage }, NO_NOTES);
      const all = await sizes(out);
      expect(all).toHaveLength(sheets);
      expectA4(all);
    });
  }

  it("A11 a single-page PDF gives one sheet at every density", async () => {
    for (const perPage of [2, 3, 4, 6] as const) {
      const out = await layoutTalkPdf(await makePdf(1), { kind: "handout", perPage }, NO_NOTES);
      expect(await sizes(out)).toHaveLength(1);
    }
  });

  it("A11 labels 1,2,2,3 make 3 slides: a 4-per-page handout has 1 sheet", async () => {
    const out = await layoutTalkPdf(await makePdf(4, [1, 2, 2, 3]), { kind: "handout", perPage: 4 }, NO_NOTES);
    expect(await sizes(out)).toHaveLength(1);
  });

  it("A11 labels 1,2,2,3 at 2 per page give 2 sheets, not 2 for four pages", async () => {
    const labelled = await layoutTalkPdf(await makePdf(4, [1, 2, 2, 3]), { kind: "handout", perPage: 2 }, NO_NOTES);
    expect(await sizes(labelled)).toHaveLength(2);
    const unlabelled = await layoutTalkPdf(await makePdf(5), { kind: "handout", perPage: 2 }, NO_NOTES);
    expect(await sizes(unlabelled)).toHaveLength(3);
  });

  it("A11 five labelled pages that are one slide give a single sheet", async () => {
    const pdf = await makePdf(5, [7, 7, 7, 7, 7]);
    const out = await layoutTalkPdf(pdf, { kind: "handout", perPage: 2 }, NO_NOTES);
    expect(await sizes(out)).toHaveLength(1);
  });

  it("A11 the output is deterministic", async () => {
    const pdf = await makePdf(5);
    const layout: TalkPdfLayout = { kind: "handout", perPage: 3 };
    const a = await layoutTalkPdf(pdf, layout, NO_NOTES);
    const b = await layoutTalkPdf(pdf, layout, NO_NOTES);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("A11 a PDF with no pages throws 'The PDF has no pages'", async () => {
    const empty = await (await PDFDocument.create({ updateMetadata: false })).save({ addDefaultPage: false });
    await expect(layoutTalkPdf(empty, { kind: "handout", perPage: 4 }, NO_NOTES)).rejects.toThrow("The PDF has no pages");
    await expect(layoutTalkPdf(empty, { kind: "notes" }, NO_NOTES)).rejects.toThrow("The PDF has no pages");
  });
});

describe("layoutTalkPdf notes pages", () => {
  const notes = { kind: "notes" } as const;

  it("A11 labels 1,2,2,3 give 3 A4 portrait sheets", async () => {
    const talk = { notes: ["NOTEONE", "NOTETWO", "NOTETHREE"] };
    const out = await layoutTalkPdf(await makePdf(4, [1, 2, 2, 3]), notes, talk);
    const all = await sizes(out);
    expect(all).toHaveLength(3);
    expectA4(all);
  });

  it("A11 slide 2's sheet holds the notes of slide index 1", async () => {
    const talk = { notes: ["NOTEONE", "NOTETWO", "NOTETHREE"], slideOfPage: [0, 1, 1, 2] };
    const out = await layoutTalkPdf(await makePdf(4, [1, 2, 2, 3]), notes, talk);
    const second = await sheetText(out, 1);
    expect(second).toContain("NOTETWO");
    expect(second).not.toContain("NOTEONE");
    expect(second).not.toContain("NOTETHREE");
    expect(await sheetText(out, 0)).toContain("NOTEONE");
    expect(await sheetText(out, 2)).toContain("NOTETHREE");
  });

  it("A11 without labels every page is a slide with its own notes", async () => {
    const talk = { notes: ["ALPHANOTE", "BETANOTE"] };
    const out = await layoutTalkPdf(await makePdf(2), notes, talk);
    expect(await sizes(out)).toHaveLength(2);
    expect(await sheetText(out, 1)).toContain("BETANOTE");
  });

  it("A11 a slide without notes gets its slide alone", async () => {
    const out = await layoutTalkPdf(await makePdf(3), notes, NO_NOTES);
    const all = await sizes(out);
    expect(all).toHaveLength(3);
    expectA4(all);
  });

  it("A11 a long note continues on an extra sheet", async () => {
    const long = Array.from({ length: 120 }, (_, i) => `Line number ${i} of the speaker notes with some words`).join("\n");
    const out = await layoutTalkPdf(await makePdf(1), notes, { notes: [long] });
    const all = await sizes(out);
    expect(all.length).toBeGreaterThan(1);
    expectA4(all);
  });

  it("A11 a long single paragraph is wrapped and also continues on extra sheets", async () => {
    const para = Array.from({ length: 1500 }, (_, i) => `word${i}`).join(" ");
    const out = await layoutTalkPdf(await makePdf(1), notes, { notes: [para] });
    expect((await sizes(out)).length).toBeGreaterThan(1);
    expect(await allText(out)).toContain("word1499");
  });

  it("A11 a short note stays on one sheet per slide", async () => {
    const out = await layoutTalkPdf(await makePdf(2), notes, { notes: ["short", "also short"] });
    expect(await sizes(out)).toHaveLength(2);
  });

  it("A11 a character outside WinAnsi does not throw", async () => {
    const talk = { notes: ["go → next", "中文 text"] };
    const out = await layoutTalkPdf(await makePdf(2), notes, talk);
    expect(await sizes(out)).toHaveLength(2);
  });

  it("A11 an unencodable character is replaced by '?'", async () => {
    const out = await layoutTalkPdf(await makePdf(1), notes, { notes: ["go → next"] });
    expect(await sheetText(out, 0)).toContain("go ? next");
  });

  it("A11 with format latex, '\\textbf{Key} point' prints as 'Key point'", async () => {
    const talk = { notes: ["\\textbf{Key} point"], format: "latex" as const };
    const out = await layoutTalkPdf(await makePdf(1), notes, talk);
    const text = await sheetText(out, 0);
    expect(text).toContain("Key point");
    expect(text).not.toContain("textbf");
  });

  it("A11 without a format the note is printed as written", async () => {
    const out = await layoutTalkPdf(await makePdf(1), notes, { notes: ["plain text here"] });
    expect(await sheetText(out, 0)).toContain("plain text here");
  });

  it("A11 the output is deterministic", async () => {
    const pdf = await makePdf(2);
    const talk = { notes: ["one", "two"] };
    const a = await layoutTalkPdf(pdf, notes, talk);
    const b = await layoutTalkPdf(pdf, notes, talk);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
