// Tests which slides of a talk the overflow badges mark: LaTeX frames holding an Overfull \vbox line, Typst slides that spill onto extra pages.
import type { SourceDeckNode } from "../../src/decks/index.js";
import { readSourceDeckProject } from "../../src/decks/sourceDeckFiles.js";
import { overfullSlides, spilledTypstSlides } from "../../src/decks/sourceDeckOverflow.js";

const files = (contents: Record<string, string>) => (path: string): string | undefined => contents[path];
const frame = (title: string, body = "Words."): string => `\\begin{frame}{${title}}\n  ${body}\n\\end{frame}\n`;
const beamer = (...parts: string[]): string => `\\documentclass{beamer}\n\\begin{document}\n${parts.join("")}\\end{document}\n`;
const typSlide = (title: string | null, body = "Words."): string => (title === null ? `#slide[\n  ${body}\n]\n` : `#slide(title: [${title}])[\n  ${body}\n]\n`);

describe("overfullSlides", () => {
  // main.tex: line 1-2 preamble, One 3-5, \input on 6, Last 7-9.  slides/intro.tex: Mid1 1-3, Mid2 4-6.
  const main = beamer(frame("One"), "\\input{slides/intro}\n", frame("Last"));
  const intro = `${frame("Mid1")}${frame("Mid2")}`;
  const tree = readSourceDeckProject("latex", "talk", "main.tex", files({ "main.tex": main, "slides/intro.tex": intro }));

  it("7.2b has the tree shape the other cases rely on", () => {
    expect(tree.map((node) => [node.title, node.file, node.line, node.endLine])).toEqual([
      ["One", undefined, 3, 5], ["Mid1", "slides/intro.tex", 1, 3], ["Mid2", "slides/intro.tex", 4, 6], ["Last", undefined, 7, 9],
    ]);
  });

  it("7.2b marks the main-file frame whose lines hold the mark", () => {
    expect(overfullSlides(tree, [{ file: "main.tex", line: 4 }], "main.tex")).toEqual(new Set([0]));
    expect(overfullSlides(tree, [{ file: "main.tex", line: 8 }], "main.tex")).toEqual(new Set([3]));
  });

  it("7.2b counts the first and the last line of a frame as inside it", () => {
    expect(overfullSlides(tree, [{ file: "main.tex", line: 3 }], "main.tex")).toEqual(new Set([0]));
    expect(overfullSlides(tree, [{ file: "main.tex", line: 5 }], "main.tex")).toEqual(new Set([0]));
    expect(overfullSlides(tree, [{ file: "main.tex", line: 7 }], "main.tex")).toEqual(new Set([3]));
    expect(overfullSlides(tree, [{ file: "main.tex", line: 9 }], "main.tex")).toEqual(new Set([3]));
  });

  it("7.2b marks the frame of an included file by file", () => {
    expect(overfullSlides(tree, [{ file: "slides/intro.tex", line: 2 }], "main.tex")).toEqual(new Set([1]));
    expect(overfullSlides(tree, [{ file: "slides/intro.tex", line: 5 }], "main.tex")).toEqual(new Set([2]));
  });

  it("7.2b does not mark a main-file frame for a mark of an included file on the same line number", () => {
    // Line 4 lies in main's One (3-5) and in intro's Mid2 (4-6); only the file decides.
    expect(overfullSlides(tree, [{ file: "slides/intro.tex", line: 4 }], "main.tex")).toEqual(new Set([2]));
    expect(overfullSlides(tree, [{ file: "main.tex", line: 4 }], "main.tex")).toEqual(new Set([0]));
  });

  it("7.2b ignores marks outside every frame", () => {
    const outside = [{ file: "main.tex", line: 1 }, { file: "main.tex", line: 2 }, { file: "main.tex", line: 6 }, { file: "main.tex", line: 10 }, { file: "slides/intro.tex", line: 7 }];
    expect(overfullSlides(tree, outside, "main.tex")).toEqual(new Set());
  });

  it("7.2b ignores marks of another file", () => {
    expect(overfullSlides(tree, [{ file: "other.tex", line: 4 }, { file: "slides/other.tex", line: 2 }], "main.tex")).toEqual(new Set());
  });

  it("7.2b joins the slides of several marks and counts a slide once", () => {
    const marks = [{ file: "main.tex", line: 4 }, { file: "main.tex", line: 5 }, { file: "slides/intro.tex", line: 2 }, { file: "main.tex", line: 6 }];
    expect(overfullSlides(tree, marks, "main.tex")).toEqual(new Set([0, 1]));
  });

  it("7.2b gives an empty set for no marks", () => {
    expect(overfullSlides(tree, [], "main.tex")).toEqual(new Set());
  });

  it("7.2b reads a node without a file as the main path, whatever folder it sits in", () => {
    const nested = readSourceDeckProject("latex", "talk", "talk/main.tex", files({ "talk/main.tex": main, "talk/slides/intro.tex": intro }));
    expect(nested[1]!.file).toBe("talk/slides/intro.tex");
    expect(overfullSlides(nested, [{ file: "talk/main.tex", line: 8 }], "talk/main.tex")).toEqual(new Set([3]));
    expect(overfullSlides(nested, [{ file: "talk/slides/intro.tex", line: 2 }], "talk/main.tex")).toEqual(new Set([1]));
    expect(overfullSlides(nested, [{ file: "main.tex", line: 8 }], "talk/main.tex")).toEqual(new Set());
  });

  it("7.2b compares paths after normalising ./ segments", () => {
    expect(overfullSlides(tree, [{ file: "./main.tex", line: 4 }], "main.tex")).toEqual(new Set([0]));
  });

  it("7.2b returns indexes of the slides in the tree, not of nested nodes", () => {
    const withChildren = readSourceDeckProject("latex", "talk", "main.tex", files({
      "main.tex": beamer(frame("One", "\\begin{itemize}\n    \\item A\n  \\end{itemize}"), frame("Two")),
    }));
    // Frame One holds lines 3-7; the mark sits inside its itemize.
    expect(overfullSlides(withChildren, [{ file: "main.tex", line: 5 }], "main.tex")).toEqual(new Set([0]));
  });

  it("7.2b only marks nodes of kind slide", () => {
    const node = (kind: SourceDeckNode["kind"], line: number, endLine: number): SourceDeckNode => ({ kind, range: [0, 0], line, endLine, props: {} });
    const hand = [node("column", 1, 10), node("slide", 1, 10)];
    expect(overfullSlides(hand, [{ file: "main.tex", line: 5 }], "main.tex")).toEqual(new Set([1]));
  });
});

describe("spilledTypstSlides", () => {
  const textOfMain = (text: string) => (file: string | undefined): string => (file === undefined ? text : "");
  const three = typSlide("Alpha") + typSlide("Beta") + typSlide("Gamma");
  const threeTree = readSourceDeckProject("typst", "talk", "main.typ", files({ "main.typ": three }));

  it("7.2c has the tree shape the other cases rely on", () => {
    expect(threeTree.map((node) => [node.kind, node.title])).toEqual([["slide", "Alpha"], ["slide", "Beta"], ["slide", "Gamma"]]);
  });

  it("7.2c marks the slide whose title page is followed by an extra page", () => {
    const pages = ["Alpha intro", "Beta first part", "Beta second part", "Gamma end"];
    expect(spilledTypstSlides(threeTree, textOfMain(three), pages)).toEqual(new Set([1]));
  });

  it("7.2c marks the last slide when pages remain after its first page", () => {
    const pages = ["Alpha", "Beta", "Gamma first", "Gamma second"];
    expect(spilledTypstSlides(threeTree, textOfMain(three), pages)).toEqual(new Set([2]));
  });

  it("7.2c marks the first slide when its title page is followed by an extra page", () => {
    const pages = ["Alpha", "continued", "Beta", "Gamma"];
    expect(spilledTypstSlides(threeTree, textOfMain(three), pages)).toEqual(new Set([0]));
  });

  it("7.2c marks every spilling slide and counts the pages after them", () => {
    const pages = ["Alpha", "more", "more", "Beta", "Gamma", "more"];
    expect(spilledTypstSlides(threeTree, textOfMain(three), pages)).toEqual(new Set([0, 2]));
  });

  it("7.2c gives an empty set when there are as many pages as slides", () => {
    expect(spilledTypstSlides(threeTree, textOfMain(three), ["Alpha", "Beta", "Gamma"])).toEqual(new Set());
  });

  it("7.2c gives an empty set when there are fewer pages than slides", () => {
    expect(spilledTypstSlides(threeTree, textOfMain(three), ["Alpha", "Beta"])).toEqual(new Set());
  });

  it("7.2c gives an empty set when a titled slide is not found on any page", () => {
    const pages = ["Alpha", "Beta", "more", "text without the third heading"];
    expect(spilledTypstSlides(threeTree, textOfMain(three), pages)).toEqual(new Set());
  });

  it("7.2c does not look for a title on a page before the previous slide's first page", () => {
    // Gamma's title only appears before Beta's page, so walking forward cannot find it.
    const pages = ["Alpha", "Gamma", "Beta", "filler", "filler"];
    expect(spilledTypstSlides(threeTree, textOfMain(three), pages)).toEqual(new Set());
  });

  it("7.2c matches a title ignoring case and whitespace differences", () => {
    const text = typSlide("Alpha") + typSlide("Beta   Results") + typSlide("Gamma");
    const tree = readSourceDeckProject("typst", "talk", "main.typ", files({ "main.typ": text }));
    const pages = ["ALPHA", "beta\n  results\n body", "continued", "gamma"];
    expect(spilledTypstSlides(tree, textOfMain(text), pages)).toEqual(new Set([1]));
  });

  it("7.2c finds a title inside longer page text", () => {
    const pages = ["header Alpha footer", "x Beta y", "more", "see Gamma now"];
    expect(spilledTypstSlides(threeTree, textOfMain(three), pages)).toEqual(new Set([1]));
  });

  it("7.2c gives an untitled slide the page after the previous slide's first page", () => {
    const text = typSlide("Alpha") + typSlide(null, "Untitled body") + typSlide("Gamma");
    const tree = readSourceDeckProject("typst", "talk", "main.typ", files({ "main.typ": text }));
    expect(tree[1]!.title).toBeUndefined();
    const pages = ["Alpha", "something", "something else", "Gamma"];
    expect(spilledTypstSlides(tree, textOfMain(text), pages)).toEqual(new Set([1]));
  });

  it("7.2c stays known when an untitled slide sits between titled ones", () => {
    const text = typSlide("Alpha") + typSlide(null) + typSlide("Gamma") + typSlide("Delta");
    const tree = readSourceDeckProject("typst", "talk", "main.typ", files({ "main.typ": text }));
    const pages = ["Alpha", "x", "Gamma", "Delta", "Delta again"];
    expect(spilledTypstSlides(tree, textOfMain(text), pages)).toEqual(new Set([3]));
  });

  it.each(["#pause", "#uncover(2)[More]", "#only(2)[More]", "#meanwhile", "#alternatives[A][B]", "#one-by-one[A][B]"])(
    "7.2c does not mark a spilling slide whose source holds %s",
    (overlay) => {
      const text = typSlide("Alpha") + typSlide("Beta", `First\n  ${overlay}\n  Second`) + typSlide("Gamma");
      const tree = readSourceDeckProject("typst", "talk", "main.typ", files({ "main.typ": text }));
      const pages = ["Alpha", "Beta", "Beta overlay", "Gamma"];
      expect(spilledTypstSlides(tree, textOfMain(text), pages)).toEqual(new Set());
    },
  );

  it("7.2c does not mark a spilling slide whose source holds `pause`", () => {
    const text = typSlide("Alpha") + typSlide("Beta", "Use `pause` between steps") + typSlide("Gamma");
    const tree = readSourceDeckProject("typst", "talk", "main.typ", files({ "main.typ": text }));
    expect(spilledTypstSlides(tree, textOfMain(text), ["Alpha", "Beta", "more", "Gamma"])).toEqual(new Set());
  });

  it("7.2c looks for an overlay call in the spilling slide only, not in its neighbours", () => {
    const text = typSlide("Alpha", "#pause\n  Words") + typSlide("Beta") + typSlide("Gamma", "#uncover(2)[x]");
    const tree = readSourceDeckProject("typst", "talk", "main.typ", files({ "main.typ": text }));
    const pages = ["Alpha", "Beta", "more", "Gamma"];
    expect(spilledTypstSlides(tree, textOfMain(text), pages)).toEqual(new Set([1]));
  });

  it("7.2c reads the source of a slide from the file the node names", () => {
    const main = typSlide("Alpha") + '#include "parts/a.typ"\n' + typSlide("Gamma");
    const part = typSlide("Beta", "First\n  #pause\n  Second");
    const tree = readSourceDeckProject("typst", "talk", "main.typ", files({ "main.typ": main, "parts/a.typ": part }));
    expect(tree.map((node) => node.file)).toEqual([undefined, "parts/a.typ", undefined]);
    const asked: Array<string | undefined> = [];
    const textOf = (file: string | undefined): string => { asked.push(file); return file === undefined ? main : file === "parts/a.typ" ? part : ""; };
    expect(spilledTypstSlides(tree, textOf, ["Alpha", "Beta", "Beta pause", "Gamma"])).toEqual(new Set());
    expect(asked).toContain("parts/a.typ");
    // Without the overlay the same included slide is marked.
    const plain = typSlide("Beta", "First\n  Second");
    const plainTree = readSourceDeckProject("typst", "talk", "main.typ", files({ "main.typ": main, "parts/a.typ": plain }));
    const plainOf = (file: string | undefined): string => (file === undefined ? main : file === "parts/a.typ" ? plain : "");
    expect(spilledTypstSlides(plainTree, plainOf, ["Alpha", "Beta", "Beta pause", "Gamma"])).toEqual(new Set([1]));
  });

  it("7.2c returns tree indexes when the tree also holds non-slide nodes", () => {
    const text = typSlide("Alpha") + typSlide("Beta");
    const slides = readSourceDeckProject("typst", "talk", "main.typ", files({ "main.typ": text }));
    const extra: SourceDeckNode = { kind: "code", range: [0, 0], line: 1, endLine: 1, props: {} };
    const tree = [extra, ...slides];
    expect(spilledTypstSlides(tree, textOfMain(text), ["Alpha", "Beta", "more"])).toEqual(new Set([2]));
  });

  it("7.2c gives an empty set for a tree without slides", () => {
    expect(spilledTypstSlides([], textOfMain(""), ["a", "b"])).toEqual(new Set());
  });
});
