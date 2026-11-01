// Tests the stored drawing block (decision D1): readDrawingBlock accepts exactly the div with the five parts in order, formatDrawingBlock writes it under the 256 KB cap; the block half of acceptance A1.
import { createHash } from "node:crypto";
import { formatDrawingBlock, readDrawingBlock } from "../../../src/qmd/drawing/block";
import type { DrawingModel } from "../../../src/qmd/drawing/model";

const CAP = 262144;
const FENCE = "```";
const BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC";
const PNG = `data:image/png;base64,${BASE64}`;
const TIKZ = [
  "\\begin{tikzpicture}[x=0.5cm,y=0.5cm,>=stealth,line width=0.6pt]",
  "\\coordinate (A) at (0,0);",
  "\\coordinate (B) at (4,0);",
  "\\draw[->] (A) -- (B);",
  "\\end{tikzpicture}",
].join("\n");
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>';
const ALT = "Drawing A B";
const MODEL = {
  v: 1,
  points: [{ id: "A", x: 0, y: 0, dot: true, label: "$A$" }, { id: "B", x: 4, y: 0, dot: true, label: "$B$" }],
  items: [{ k: "seg", a: "A", b: "B", arrow: "end" }],
} as unknown as DrawingModel;
const MODEL_JSON = JSON.stringify(MODEL);

const hash = (tikz: string): string => createHash("sha256").update(tikz).digest("hex").slice(0, 12);
const parts = (over: Partial<{ model: DrawingModel; tikz: string; png: string; alt: string; svg: string }> = {}) => ({ model: MODEL, tikz: TIKZ, png: PNG, alt: ALT, svg: SVG, ...over });

interface Layout { tikz: string; png: string; alt: string; svg: string; json: string; source: string; sep: string; eol: string; open: string }

/** The block of decision D1 written by hand, one array entry per part. */
function pieces(over: Partial<Layout> = {}): string[] {
  const l: Layout = { tikz: TIKZ, png: PNG, alt: ALT, svg: SVG, json: MODEL_JSON, source: hash(over.tikz ?? TIKZ), sep: "\n\n", eol: "\n", open: "", ...over };
  return [
    l.open || `::: {.labshelf-drawing source=${l.source}}`,
    [`${FENCE}{=latex}`, `\\makeatletter\\@ifundefined{tikzpicture}{\\iftrue}{${l.tikz}\\iffalse}\\makeatother`, FENCE].join("\n"),
    `![](${l.png}){fig-alt="${l.alt}"}`,
    [`${FENCE}{=latex}`, "\\fi", FENCE].join("\n"),
    [`${FENCE}{=labshelf-svg}`, l.svg, FENCE].join("\n"),
    [`${FENCE}{=labshelf-drawing}`, l.json, FENCE].join("\n"),
    ":::",
  ];
}

function hand(over: Partial<Layout> = {}): string {
  const { sep, eol } = { sep: "\n\n", eol: "\n", ...over };
  const all = pieces(over);
  return [all[0]!, all.slice(1, 6).join(sep), all[6]!].join("\n").replace(/\n/g, eol);
}

/** The hand-written block without one of its five parts (0 guard, 1 image, 2 fi, 3 svg, 4 model). */
function without(index: number): string {
  const all = pieces();
  const body = all.slice(1, 6).filter((_, i) => i !== index);
  return [all[0]!, body.join("\n\n"), all[6]!].join("\n");
}

/** The hand-written block with its five parts in the given order. */
function ordered(order: number[]): string {
  const all = pieces();
  const body = order.map((i) => all[1 + i]!);
  return [all[0]!, body.join("\n\n"), all[6]!].join("\n");
}

const must = (text: string) => {
  const block = readDrawingBlock(text);
  if (block === null) { throw new Error("expected a drawing block"); }
  return block;
};

describe("A1 readDrawingBlock reads the stored form", () => {
  it("A1 reads the five parts of a block written by hand", () => {
    const block = must(hand());
    expect(block.tikz).toBe(TIKZ);
    expect(block.alt).toBe(ALT);
    expect(block.svg).toBe(SVG);
    expect(block.png).toContain(BASE64);
    expect(block.model).toEqual(MODEL);
  });

  it("A1 reads source from the opener and finds no hand edit when it matches the TikZ hash", () => {
    const block = must(hand());
    expect(block.source).toBe(hash(TIKZ));
    expect(block.handEdited).toBe(false);
  });

  it("A1 reads a block with Windows line endings", () => {
    const block = must(hand({ eol: "\r\n" }));
    expect(block.tikz.replace(/\r\n/g, "\n")).toBe(TIKZ);
    expect(block.svg).toBe(SVG);
    expect(block.alt).toBe(ALT);
    expect(block.model).toEqual(MODEL);
    expect(block.handEdited).toBe(false);
  });

  it("A1 reads a block with extra blank lines between the parts", () => {
    const block = must(hand({ sep: "\n\n\n" }));
    expect(block.tikz).toBe(TIKZ);
    expect(block.model).toEqual(MODEL);
  });

  it("A1 reads an alt text with punctuation", () => {
    expect(must(hand({ alt: "Drawing: A, B (C) to D" })).alt).toBe("Drawing: A, B (C) to D");
  });

  it("A1 marks a block whose TikZ was edited after it was written", () => {
    const block = must(hand().replace("\\draw[->]", "\\draw[<-]"));
    expect(block.handEdited).toBe(true);
    expect(block.tikz).toContain("\\draw[<-] (A) -- (B);");
    expect(block.source).toBe(hash(TIKZ));
  });

  it("A1 marks a block whose source attribute is not the hash of its TikZ", () => {
    const block = must(hand({ source: "000000000000" }));
    expect(block.handEdited).toBe(true);
    expect(block.source).toBe("000000000000");
  });

  it("A1 still reads the svg and model of a hand-edited block", () => {
    const block = must(hand({ source: "000000000000" }));
    expect(block.svg).toBe(SVG);
    expect(block.model).toEqual(MODEL);
  });
});

describe("A1 readDrawingBlock leaves anything else as not a drawing", () => {
  it.each([
    [0, "the TikZ guard"],
    [1, "the PNG"],
    [2, "the closing \\fi"],
    [3, "the svg fence"],
    [4, "the model fence"],
  ])("A1 rejects a block with part %i (%s) missing", (index) => {
    expect(readDrawingBlock(without(index))).toBeNull();
  });

  it.each([
    ["the svg and the model swapped", [0, 1, 2, 4, 3]],
    ["the model first", [4, 0, 1, 2, 3]],
    ["the closing \\fi before the PNG", [0, 2, 1, 3, 4]],
    ["the PNG before the guard", [1, 0, 2, 3, 4]],
  ])("A1 rejects a block with %s", (_name, order) => {
    expect(readDrawingBlock(ordered(order))).toBeNull();
  });

  it("A1 rejects a guard that does not test tikzpicture", () => {
    expect(readDrawingBlock(hand().replace("@ifundefined{tikzpicture}", "@ifundefined{tikz}"))).toBeNull();
  });

  it("A1 rejects a guard that does not end with \\iffalse", () => {
    expect(readDrawingBlock(hand().replace("\\iffalse}\\makeatother", "}\\makeatother"))).toBeNull();
  });

  it("A1 rejects a closing fence that is not \\fi", () => {
    expect(readDrawingBlock(hand().replace(`${FENCE}{=latex}\n\\fi\n`, `${FENCE}{=latex}\n\\relax\n`))).toBeNull();
  });

  it("A1 rejects a div of another class", () => {
    expect(readDrawingBlock(hand({ open: `::: {.labshelf-output source=${hash(TIKZ)}}` }))).toBeNull();
  });

  it("A1 rejects a block with text before it", () => {
    expect(readDrawingBlock(`Some text.\n\n${hand()}`)).toBeNull();
  });

  it("A1 rejects a block with text after it", () => {
    expect(readDrawingBlock(`${hand()}\n\nSome text.`)).toBeNull();
  });

  it("A1 rejects a block with a paragraph between its parts", () => {
    const all = pieces();
    const text = [all[0]!, [all[1]!, all[2]!, "A caption.", all[3]!, all[4]!, all[5]!].join("\n\n"), all[6]!].join("\n");
    expect(readDrawingBlock(text)).toBeNull();
  });

  it("A1 rejects a block whose model is not JSON", () => {
    expect(readDrawingBlock(hand({ json: "{not json" }))).toBeNull();
  });

  it("A1 rejects a block whose model has an unknown version", () => {
    expect(readDrawingBlock(hand({ json: '{"v":2,"points":[],"items":[]}' }))).toBeNull();
  });

  it("A1 rejects empty text and plain text", () => {
    expect(readDrawingBlock("")).toBeNull();
    expect(readDrawingBlock("Just a paragraph.")).toBeNull();
  });

  it("A1 rejects a block over the 256 KB cap", () => {
    const big = hand({ svg: `<svg>${"x".repeat(CAP)}</svg>` });
    expect(readDrawingBlock(big)).toBeNull();
  });

  it("A1 reads a large block that is under the cap", () => {
    expect(readDrawingBlock(hand({ svg: `<svg>${"x".repeat(200000)}</svg>` }))).not.toBeNull();
  });
});

describe("A1 formatDrawingBlock writes the stored form", () => {
  it("A1 writes the div of D1 with its parts in order", () => {
    const text = formatDrawingBlock(parts(), "\n")!;
    expect(text.startsWith(`::: {.labshelf-drawing source=${hash(TIKZ)}}\n`)).toBe(true);
    expect(text.trimEnd().endsWith(":::")).toBe(true);
    const guard = text.indexOf(`\\makeatletter\\@ifundefined{tikzpicture}{\\iftrue}{${TIKZ}\\iffalse}\\makeatother`);
    const image = text.indexOf("![](");
    const fi = text.indexOf("\\fi\n");
    const svg = text.indexOf(`${FENCE}{=labshelf-svg}`);
    const model = text.indexOf(`${FENCE}{=labshelf-drawing}`);
    expect(guard).toBeGreaterThan(0);
    expect([guard, image, fi, svg, model].every((at, i, all) => i === 0 || at > all[i - 1]!)).toBe(true);
    expect(text).toContain(`{fig-alt="${ALT}"}`);
  });

  it("A1 writes the svg and the model each on one line", () => {
    const lines = formatDrawingBlock(parts(), "\n")!.split("\n");
    expect(lines).toContain(SVG);
    const at = lines.indexOf(`${FENCE}{=labshelf-drawing}`);
    expect(JSON.parse(lines[at + 1]!)).toEqual(MODEL);
    expect(lines[at + 2]).toBe(FENCE);
  });

  it("A1 reads back what it wrote", () => {
    const block = must(formatDrawingBlock(parts(), "\n")!);
    expect(block.tikz).toBe(TIKZ);
    expect(block.png).toBe(PNG);
    expect(block.alt).toBe(ALT);
    expect(block.svg).toBe(SVG);
    expect(block.model).toEqual(MODEL);
    expect(block.source).toBe(hash(TIKZ));
    expect(block.handEdited).toBe(false);
  });

  it("A1 writes the same bytes after a read", () => {
    const text = formatDrawingBlock(parts(), "\n")!;
    const { model, tikz, png, alt, svg } = must(text);
    expect(formatDrawingBlock({ model, tikz, png, alt, svg }, "\n")).toBe(text);
  });

  it("A1 writes source as the first 12 hex digits of the SHA-256 of the TikZ", () => {
    const tikz = "\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}";
    const text = formatDrawingBlock(parts({ tikz }), "\n")!;
    expect(text).toMatch(/^::: \{\.labshelf-drawing source=[0-9a-f]{12}\}/);
    expect(text.startsWith(`::: {.labshelf-drawing source=${hash(tikz)}}`)).toBe(true);
  });

  it("A1 writes the line ending it is given", () => {
    const text = formatDrawingBlock(parts(), "\r\n")!;
    expect(text).toContain("\r\n");
    expect(text).not.toMatch(/(?<!\r)\n/);
    expect(formatDrawingBlock(parts(), "\n")!).not.toContain("\r");
  });

  it("A1 reads back a block written with Windows line endings", () => {
    const block = must(formatDrawingBlock(parts(), "\r\n")!);
    expect(block.tikz.replace(/\r\n/g, "\n")).toBe(TIKZ);
    expect(block.svg).toBe(SVG);
    expect(block.model).toEqual(MODEL);
    expect(block.handEdited).toBe(false);
  });

  it("A1 writes a block under the cap", () => {
    expect(formatDrawingBlock(parts({ png: `data:image/png;base64,${"A".repeat(200000)}` }), "\n")).not.toBeNull();
  });

  it("A1 returns null for a block over 256 KB", () => {
    expect(formatDrawingBlock(parts({ png: `data:image/png;base64,${"A".repeat(300000)}` }), "\n")).toBeNull();
  });

  it("A1 counts the cap in UTF-8 bytes, not characters", () => {
    const svg = `<svg>${"\u00e9".repeat(140000)}</svg>`;
    expect(svg.length).toBeLessThan(CAP);
    expect(formatDrawingBlock(parts({ svg }), "\n")).toBeNull();
  });

  it("A1 writes multi-byte text under the cap", () => {
    const svg = `<svg>${"\u00e9".repeat(60000)}</svg>`;
    expect(formatDrawingBlock(parts({ svg }), "\n")).not.toBeNull();
  });
});
