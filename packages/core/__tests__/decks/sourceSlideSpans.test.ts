// The spans a talk's or poster's code shows one at a time: the preamble, then one span per main-file slide or poster block, covering the whole text.
import { describeSourceDeckNode, readSourceDeckBlocks } from "../../src/decks/index.js";
import { sourceDeckSpanAt, sourceDeckSpans, sourceDeckUnits, sourceSlideSpanAt, sourceSlideSpans } from "../../src/decks/sourceSlideSpans";

const TEX = [
  "\\documentclass{beamer}", "\\begin{document}",
  "\\begin{frame}{One}", "Hello", "\\end{frame}",
  "\\section{Two}",
  "\\begin{frame}{Two}", "Body", "\\end{frame}",
  "\\end{document}", "",
].join("\n");

describe("sourceSlideSpans", () => {
  const tree = readSourceDeckBlocks("latex", "talk", TEX);
  const spans = sourceSlideSpans("latex", TEX, tree)!;

  it("ends the preamble on the line of \\begin{document}", () => {
    expect(TEX.slice(...spans.preamble)).toBe("\\documentclass{beamer}\n\\begin{document}");
  });

  it("gives lines between slides to the slide after them and the text's end to the last slide", () => {
    expect(TEX.slice(...spans.slides.get(0)!)).toBe("\\begin{frame}{One}\nHello\n\\end{frame}");
    expect(TEX.slice(...spans.slides.get(1)!)).toBe("\\section{Two}\n\\begin{frame}{Two}\nBody\n\\end{frame}\n\\end{document}\n");
  });

  it("finds the span of an offset", () => {
    expect(sourceSlideSpanAt(spans, 3)).toBe("preamble");
    expect(sourceSlideSpanAt(spans, TEX.indexOf("Hello"))).toBe(0);
    expect(sourceSlideSpanAt(spans, TEX.indexOf("\\section"))).toBe(1);
    expect(sourceSlideSpanAt(spans, TEX.length)).toBe(1);
  });

  it("starts a Typst preamble's end at the first slide, and gives null without a slide", () => {
    const typ = "#import \"x\": *\n\n== One\nHi\n";
    const typSpans = sourceSlideSpans("typst", typ, readSourceDeckBlocks("typst", "talk", typ))!;
    expect(typ.slice(...typSpans.preamble)).toBe("#import \"x\": *\n");
    expect(sourceSlideSpans("latex", "\\documentclass{beamer}\n", [])).toBeNull();
  });
});

describe("sourceDeckSpans of a poster", () => {
  const POSTER = [
    "% labshelf: poster", "\\documentclass{tikzposter}", "\\begin{document}", "\\maketitle",
    "\\begin{columns}", "\\column{0.5}",
    "\\block{One}{A}", "\\block{Two}{B}",
    "\\column{0.5}",
    "\\block{Three}{C}",
    "\\end{columns}", "\\end{document}", "",
  ].join("\n");
  const tree = readSourceDeckBlocks("latex", "poster", POSTER);
  const units = sourceDeckUnits("poster", tree);
  const spans = sourceDeckSpans("latex", POSTER, units)!;
  const text = (i: number): string => POSTER.slice(...spans.units[i]!.range);

  it("keys the blocks of the columns by [column, block] in document order", () => {
    expect(units.map((unit) => describeSourceDeckNode(unit.node, 0))).toEqual(["One", "Two", "Three"]);
    expect(units.map((unit) => tree[unit.path[0]!]!.kind)).toEqual(["column", "column", "column"]);
  });

  it("ends the preamble on \\begin{document} and gives column markers to the block after them and the end to the last block", () => {
    expect(POSTER.slice(...spans.preamble)).toBe("% labshelf: poster\n\\documentclass{tikzposter}\n\\begin{document}");
    expect(text(0)).toBe("\\maketitle\n\\begin{columns}\n\\column{0.5}\n\\block{One}{A}");
    expect(text(1)).toBe("\\block{Two}{B}");
    expect(text(2)).toBe("\\column{0.5}\n\\block{Three}{C}\n\\end{columns}\n\\end{document}\n");
  });

  it("finds the block of an offset by its path", () => {
    expect(sourceDeckSpanAt(spans, 0)).toBe("preamble");
    expect(sourceDeckSpanAt(spans, POSTER.indexOf("\\column{0.5}\n\\block{Three}"))).toEqual(units[2]!.path);
  });
});

describe("describeSourceDeckNode", () => {
  it("reads a LaTeX title as the slide shows it", () => {
    const [slide] = readSourceDeckBlocks("latex", "talk", "\\begin{frame}{Os primos são raros\\ldots{} \\emph{e} 1--2 \\& 3~4}\nx\n\\end{frame}\n");
    expect(describeSourceDeckNode(slide!, 0)).toBe("Os primos são raros… e 1–2 & 3 4");
  });
});
