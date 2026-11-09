// The outline, notes and slide moves of LaTeX and Typst talks and posters.
// These tests run Typst decks, which are off in the product.
jest.mock("../../src/decks/typstDecks", () => ({ TYPST_DECKS_ENABLED: true }));
import { deleteSourceSlide, duplicateSourceSlide, moveSourceSlide, readSourceDeckNotes, readSourceDeckOutline } from "../../src/decks/sourceDeckOutline.js";
import { scaffoldSourceDeck } from "../../src/decks/sourceDeckScaffold.js";
import { detectSourceDeckKind } from "../../src/decks/sourceDecks.js";

const BEAMER = `\\documentclass{beamer}
\\begin{document}
\\begin{frame}
  \\titlepage
\\end{frame}
% \\begin{frame}{Commented}
\\begin{frame}<1-2>[fragile]{First \\emph{one}}
  A \\note{Say hello.}
\\end{frame}

\\begin{frame}
  \\frametitle{Second}
  B
  \\note[item]{Point one}
\\end{frame}
\\end{document}
`;

const TOUYING = `#import "@preview/touying:0.5.2": *
#show: simple-theme

= Section

== Intro
Hello
#speaker-note[Smile.]

== Results
Numbers

= Next section
`;

const POLYLUX = `#import "@preview/polylux:0.3.1": *
#polylux-slide[
  = Welcome
]
#polylux-slide[
  == Details
  #pdfpc.speaker-note("Remember the demo")
]
`;

describe("readSourceDeckOutline", () => {
  it("lists Beamer frames with their titles, skipping commented ones", () => {
    const slides = readSourceDeckOutline("latex", "talk", BEAMER);
    expect(slides.map((s) => [s.title, s.line])).toEqual([["Title page", 3], ["First \\emph{one}", 7], ["Second", 11]]);
  });

  it("skips Beamer frames inside \\AtBeginSection / \\AtBeginSubsection and before \\begin{document}", () => {
    const text = [
      "\\documentclass{beamer}",
      "\\AtBeginSection[\\begin{frame}{Star}\\end{frame}]{\\begin{frame}{Divider}\\sectionpage\\end{frame}}",
      "\\AtBeginSubsection{\\frame{\\subsectionpage}\\begin{frame}{Sub}\\end{frame}}",
      "\\newcommand{\\extra}{\\begin{frame}{Macro}\\end{frame}}",
      "\\begin{document}",
      "\\section{One}",
      "\\begin{frame}{Real}",
      "\\note{Say it.}",
      "\\end{frame}",
      "\\end{document}",
    ].join("\n");
    expect(readSourceDeckOutline("latex", "talk", text).map((s) => [s.title, s.line])).toEqual([["Real", 7]]);
    expect(readSourceDeckNotes("latex", text)).toEqual(["Say it."]);
  });

  it("lists Typst level-2 headings as slides, each ending at the next slide or section", () => {
    const slides = readSourceDeckOutline("typst", "talk", TOUYING);
    expect(slides.map((s) => s.title)).toEqual(["Intro", "Results"]);
    expect(TOUYING.slice(slides[1]!.start, slides[1]!.end)).toBe("== Results\nNumbers\n\n");
  });

  it("lists Typst slide calls with the heading inside as the title", () => {
    expect(readSourceDeckOutline("typst", "talk", POLYLUX).map((s) => s.title)).toEqual(["Welcome", "Details"]);
  });

  it("lists poster blocks of tikzposter, beamerposter and Typst", () => {
    const tikz = "\\block{Intro}{text}\n\\block[titleleft]{Method}{more}";
    expect(readSourceDeckOutline("latex", "poster", tikz).map((b) => b.title)).toEqual(["Intro", "Method"]);
    expect(readSourceDeckOutline("latex", "poster", "\\begin{block}{Results}\nx\n\\end{block}").map((b) => b.title)).toEqual(["Results"]);
    expect(readSourceDeckOutline("typst", "poster", "= Intro\ntext\n#column-box(heading: [Method])[x]").map((b) => b.title)).toEqual(["Intro", "Method"]);
  });
});

describe("readSourceDeckNotes", () => {
  it("collects LaTeX notes per frame", () => {
    expect(readSourceDeckNotes("latex", BEAMER)).toEqual(["", "Say hello.", "Point one"]);
  });

  it("collects Typst speaker notes per slide", () => {
    expect(readSourceDeckNotes("typst", TOUYING)).toEqual(["Smile.", ""]);
    expect(readSourceDeckNotes("typst", POLYLUX)).toEqual(["", "Remember the demo"]);
  });
});

describe("slide moves", () => {
  const slides = readSourceDeckOutline("latex", "talk", BEAMER);

  it("moves a slide down keeping the text between slides in place", () => {
    const moved = moveSourceSlide(BEAMER, slides, 1, 1)!;
    expect(readSourceDeckOutline("latex", "talk", moved).map((s) => s.title)).toEqual(["Title page", "Second", "First \\emph{one}"]);
    expect(moved).toContain("% \\begin{frame}{Commented}");
    expect(moved.length).toBe(BEAMER.length);
  });

  it("refuses to move past either end", () => {
    expect(moveSourceSlide(BEAMER, slides, 0, -1)).toBeNull();
    expect(moveSourceSlide(BEAMER, slides, 2, 1)).toBeNull();
  });

  it("duplicates and deletes a slide", () => {
    const twice = duplicateSourceSlide(BEAMER, slides, 2)!;
    expect(readSourceDeckOutline("latex", "talk", twice).map((s) => s.title)).toEqual(["Title page", "First \\emph{one}", "Second", "Second"]);
    const without = deleteSourceSlide(BEAMER, slides, 0)!;
    expect(readSourceDeckOutline("latex", "talk", without).map((s) => s.title)).toEqual(["First \\emph{one}", "Second"]);
  });

  it("moves Typst heading slides", () => {
    const typstSlides = readSourceDeckOutline("typst", "talk", TOUYING);
    const moved = moveSourceSlide(TOUYING, typstSlides, 0, 1)!;
    expect(readSourceDeckOutline("typst", "talk", moved).map((s) => s.title)).toEqual(["Results", "Intro"]);
  });
});

describe("scaffoldSourceDeck", () => {
  it("writes recognised starters with slides or blocks", () => {
    const cases = [
      ["latex", { kind: "talk", aspect: "16:9" }],
      ["typst", { kind: "talk", aspect: "4:3" }],
      ["latex", { kind: "poster", size: { w: 841, h: 1189, unit: "mm" }, paper: "a1", landscape: true }],
      ["typst", { kind: "poster", size: { w: 36, h: 48, unit: "in" } }],
    ] as const;
    for (const [format, shape] of cases) {
      const text = scaffoldSourceDeck(format, "My {title} #1", shape);
      expect(detectSourceDeckKind(format, text)).toBe(shape.kind);
      expect(readSourceDeckOutline(format, shape.kind, text).length).toBeGreaterThan(1);
    }
    expect(scaffoldSourceDeck("latex", "T", cases[2][1])).toContain("[25pt, a1paper, landscape]{tikzposter}");
    expect(scaffoldSourceDeck("typst", "T", cases[3][1])).toContain("#set page(width: 36in, height: 48in");
    expect(scaffoldSourceDeck("latex", "My {title} #1", cases[0][1])).toContain("\\title{My \\{title\\} \\#1}");
  });
});
