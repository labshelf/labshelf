import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listSourceDeckShapes, readSourceDeckBlocks, scaffoldSourceDeck, type SourceDeckNode } from "../../src/decks/index.js";

const fixture = (name: string): string => readFileSync(join(__dirname, "fixtures", name), "utf8");

/** A node as `kind[:title] line-endLine {props}` with its children, for compact tree comparisons. */
type Shape = string | [string, Shape[]];
function shape(node: SourceDeckNode): Shape {
  const props = Object.entries(node.props).filter(([key]) => key !== "title").map(([key, value]) => `${key}=${value}`).join(",");
  const label = `${node.kind}${node.title !== undefined ? `:${node.title}` : ""} ${node.line}-${node.endLine}${props ? ` {${props}}` : ""}`;
  return node.children ? [label, node.children.map(shape)] : label;
}
const tree = (...args: Parameters<typeof readSourceDeckBlocks>): Shape[] => readSourceDeckBlocks(...args).map(shape);

const TIKZ: Shape[] = [
  ["column 16-22 {columnWidth=0.5}", [["block:Introduction 17-19", ["text 18-18"]], ["block:Method 20-22", ["equation 21-21"]]]],
  ["column 24-30 {columnWidth=0.5}", [["block:Results 25-27", ["text 26-26"]], ["block:Conclusion 28-30", ["text 29-29"]]]],
];
const BEAMER: Shape[] = [
  ["slide 15-18", ["code 16-16"]],
  ["slide:Motivation 20-26", ["list 21-24"]],
  ["slide:Results 28-35", [["columns 29-34", [["column 30-31 {columnWidth=0.5}", ["text 31-31"]], ["column 32-33 {columnWidth=0.5}", ["equation 33-33"]]]]]],
  ["slide:Conclusion 37-39", ["text 38-38"]],
];
const TYPST_POSTER: Shape[] = [
  ["column 12-16", [["block:Introduction 12-13", ["text 13-13"]], ["block:Method 15-16", ["equation 16-16"]]]],
  ["column 20-24", [["block:Results 20-21", ["text 21-21"]], ["block:Conclusion 23-24", ["text 24-24"]]]],
];
const TYPST_TALK: Shape[] = [
  ["slide:Motivation 19-22", ["list 20-21"]],
  ["slide:Results 24-28", [["columns 25-28", [["column 26-26", ["text 26-26"]], ["column 27-27", ["equation 27-27"]]]]]],
  ["slide:Conclusion 30-31", ["text 31-31"]],
];

describe("readSourceDeckBlocks", () => {
  it("reads the dev-library fixtures", () => {
    expect(tree("latex", "poster", fixture("a1-tikz.tex"))).toEqual(TIKZ);
    expect(tree("latex", "talk", fixture("defesa-beamer.tex"))).toEqual(BEAMER);
    expect(tree("typst", "poster", fixture("typst-a0.typ"))).toEqual(TYPST_POSTER);
    expect(tree("typst", "talk", fixture("typst-relampago.typ"))).toEqual(TYPST_TALK);
  });

  it("reads the scaffolds as the same trees", () => {
    const scaffold = (kind: "talk" | "poster", format: "latex" | "typst"): string => scaffoldSourceDeck(format, "T", listSourceDeckShapes(kind, format)[0]!.shape);
    expect(tree("latex", "poster", scaffold("poster", "latex"))).toEqual(TIKZ);
    expect(tree("latex", "talk", scaffold("talk", "latex"))).toEqual(BEAMER);
    expect(tree("typst", "poster", scaffold("poster", "typst"))).toEqual(TYPST_POSTER);
    expect(tree("typst", "talk", scaffold("talk", "typst"))).toEqual(TYPST_TALK);
  });

  it("reads beamerposter columns, blocks and figure properties, and skips comments", () => {
    expect(tree("latex", "poster", fixture("beamerposter.tex"))).toEqual([
      ["column 7-16 {columnWidth=0.45}", [["block:Introduction 8-15", ["text 9-9", "figure 10-14 {src=figures/plot.png,width=0.8,caption=A plot.,align=center}"]]]],
      ["column 17-25 {columnWidth=0.45}", [["block:Results 18-24", ["list 19-21", "table 22-22", "code 23-23"]]]],
    ]);
  });

  it("gives ranges into the text, titles and bodies included", () => {
    const text = fixture("a1-tikz.tex");
    const block = readSourceDeckBlocks("latex", "poster", text)[0]!.children![1]!;
    expect(text.slice(...block.range)).toBe("\\block{Method}{\n    \\[ \\min_{x} \\|Ax - b\\|_2^2 \\]\n  }");
    expect(text.slice(...block.titleRange!)).toBe("Method");
    expect(text.slice(...block.children![0]!.range)).toBe("\\[ \\min_{x} \\|Ax - b\\|_2^2 \\]");
  });

  it("reads Typst figures, slide calls and unknown calls", () => {
    const text = "#slide(title: [Intro])[\n  #figure(image(\"a.png\", width: 50%), caption: [Plot]) <fig>\n  #v(1cm)\n  // = not a heading\n  #table(columns: 2)[a][b]\n]\n";
    expect(tree("typst", "talk", text)).toEqual([["slide:Intro 1-6", ["figure 2-2 {src=a.png,width=0.5,caption=Plot}", "code 3-3", "table 5-5"]]]);
    expect(tree("typst", "poster", "#align(center)[#image(\"b.png\")]\n")).toEqual([["column 1-1", ["figure 1-1 {src=b.png,align=center}"]]]);
  });

  it("ends the tree at an unbalanced brace with one code node", () => {
    const latex = "\\begin{frame}{A}\nx\n\\end{frame}\n\\begin{frame}{B}\n\\textbf{y\n\\end{frame}\n";
    expect(tree("latex", "talk", latex)).toEqual([["slide:A 1-3", ["text 2-2"]], "code 4-6"]);
    const typst = "= One\nx\n= Two\n#box[y\n";
    expect(tree("typst", "poster", typst)).toEqual([["column 1-3", [["block:One 1-2", ["text 2-2"]], ["block:Two 3-3", []]]], "code 4-4"]);
  });
});
