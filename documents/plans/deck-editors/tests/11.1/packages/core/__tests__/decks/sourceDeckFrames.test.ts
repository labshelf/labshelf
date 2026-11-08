// Spec 11.1 (A11): which slide each numbered beamer frame shows, and how PDF pages map to slides through them.
import { readSourceDeckFrames } from "../../src/decks/sourceDeckFrames.js";
import { readSourceDeckNotes } from "../../src/decks/sourceDeckOutline.js";
import { mapPagesToSlides } from "../../src/decks/sourceDecks.js";

const DIVIDER = "\\AtBeginSection{\\begin{frame}\\sectionpage\\end{frame}}\n";

/** A beamer talk of four slides s0..s3 with `\section` before s0 and before s2. */
const talk = (preamble: string, secondSection = "\\section{Second}"): string =>
  [
    "\\documentclass{beamer}",
    preamble,
    "\\begin{document}",
    "\\section{First}",
    "\\begin{frame}{s0}\nA\n\\end{frame}",
    "\\begin{frame}{s1}\nB\n\\end{frame}",
    secondSection,
    "\\begin{frame}{s2}\nC\n\\end{frame}",
    "\\begin{frame}{s3}\nD\n\\end{frame}",
    "\\end{document}",
    "",
  ].join("\n");

describe("readSourceDeckFrames", () => {
  it("A11 puts a null before the slide after each unstarred \\section when \\AtBeginSection holds a frame", () => {
    expect(readSourceDeckFrames("latex", talk(DIVIDER))).toEqual([null, 0, 1, null, 2, 3]);
  });

  it("A11 lists the slide indices alone without \\AtBeginSection", () => {
    expect(readSourceDeckFrames("latex", talk(""))).toEqual([0, 1, 2, 3]);
  });

  it("A11 adds no null when the \\AtBeginSection body holds no frame", () => {
    expect(readSourceDeckFrames("latex", talk("\\AtBeginSection{\\par\\medskip}"))).toEqual([0, 1, 2, 3]);
  });

  it("A11 counts a \\section with a [short] argument", () => {
    expect(readSourceDeckFrames("latex", talk(DIVIDER, "\\section[Short]{Second section}"))).toEqual([null, 0, 1, null, 2, 3]);
  });

  it("A11 counts \\subsection with \\AtBeginSubsection", () => {
    const text = [
      "\\documentclass{beamer}",
      "\\AtBeginSubsection{\\begin{frame}\\subsectionpage\\end{frame}}",
      "\\begin{document}",
      "\\subsection{One}",
      "\\begin{frame}{s0}\nA\n\\end{frame}",
      "\\subsection[Two]{Two long}",
      "\\begin{frame}{s1}\nB\n\\end{frame}",
      "\\end{document}",
      "",
    ].join("\n");
    expect(readSourceDeckFrames("latex", text)).toEqual([null, 0, null, 1]);
  });

  it("A11 recognises a divider written with \\frame", () => {
    expect(readSourceDeckFrames("latex", talk("\\AtBeginSection{\\frame{\\sectionpage}}"))).toEqual([null, 0, 1, null, 2, 3]);
  });

  it("A11 adds no null for a starred \\section when only the body holds a frame", () => {
    expect(readSourceDeckFrames("latex", talk(DIVIDER, "\\section*{Second}"))).toEqual([null, 0, 1, 2, 3]);
  });

  it("A11 adds a null for a starred \\section when [opt] itself holds a frame", () => {
    const preamble = "\\AtBeginSection[\\begin{frame}\\sectionpage\\end{frame}]{\\begin{frame}\\sectionpage\\end{frame}}";
    expect(readSourceDeckFrames("latex", talk(preamble, "\\section*{Second}"))).toEqual([null, 0, 1, null, 2, 3]);
  });

  it("A11 leaves out a source frame with noframenumbering, whose pages share the previous label", () => {
    const text = [
      "\\documentclass{beamer}",
      "\\begin{document}",
      "\\begin{frame}{s0}\nA\n\\end{frame}",
      "\\begin{frame}[noframenumbering]{s1}\nB\n\\end{frame}",
      "\\begin{frame}{s2}\nC\n\\end{frame}",
      "\\end{document}",
      "",
    ].join("\n");
    expect(readSourceDeckFrames("latex", text)).toEqual([0, 2]);
  });

  it("A11 uses the same slide indices as readSourceDeckNotes", () => {
    const text = talk(DIVIDER);
    const slides = readSourceDeckNotes("latex", text).length;
    expect(readSourceDeckFrames("latex", text).filter((f): f is number => f !== null)).toEqual(Array.from({ length: slides }, (_, i) => i));
  });

  it("A11 returns the slide indices for a Typst talk", () => {
    const typst = [
      '#import "@preview/touying:0.5.2": *',
      "#show: simple-theme",
      "",
      "= Section",
      "",
      "== Intro",
      "Hello",
      "",
      "== Results",
      "Numbers",
      "",
      "== Last",
      "End",
      "",
    ].join("\n");
    const slides = readSourceDeckNotes("typst", typst).length;
    expect(slides).toBe(3);
    expect(readSourceDeckFrames("typst", typst)).toEqual([0, 1, 2]);
  });
});

describe("mapPagesToSlides with frames", () => {
  const frames = [null, 0, 1, null, 2, 3];
  const labels = ["1", "2", "2", "3", "4", "5", "6"];

  it("A11 maps divider pages to -1 and the others to their slide", () => {
    expect(mapPagesToSlides(labels, 7, frames)).toEqual([-1, 0, 0, 1, -1, 2, 3]);
  });

  it("A11 maps overlay pages of a frame to that frame's slide when no frame is null", () => {
    expect(mapPagesToSlides(["1", "2", "2", "3"], 4, [0, 1, 2])).toEqual([0, 1, 1, 2]);
  });

  it("A11 falls back to the number rules when a label lies past the frames, giving null when pages differ from the slide count", () => {
    expect(mapPagesToSlides(["1", "2", "7"], 3, [null, 0])).toBeNull();
  });

  it("A11 falls back to the identity when a label lies past the frames and pages equal the count of non-null frames", () => {
    expect(mapPagesToSlides(["1", "5"], 2, [null, 0, 1])).toEqual([0, 1]);
  });

  it("A11 falls back to the number rules when the labels go down", () => {
    expect(mapPagesToSlides(["2", "1", "3"], 3, [null, 0, 1, 2])).toEqual([0, 1, 2]);
    expect(mapPagesToSlides(["2", "1"], 2, [null, 0, 1, 2])).toBeNull();
  });

  it("A11 falls back to the number rules for labels that are not integers or are missing", () => {
    expect(mapPagesToSlides(["i", "ii"], 2, [null, 0, 1])).toEqual([0, 1]);
    expect(mapPagesToSlides(null, 2, [null, 0, 1])).toEqual([0, 1]);
    expect(mapPagesToSlides(null, 5, [null, 0, 1])).toBeNull();
  });

  it("A11 treats label 0 as past the frames", () => {
    expect(mapPagesToSlides(["0", "1"], 2, [null, 0])).toBeNull();
  });
});

describe("mapPagesToSlides with a slide count", () => {
  it("A11 keeps the number form's results", () => {
    expect(mapPagesToSlides(["1", "2", "2", "3"], 4, 3)).toEqual([0, 1, 1, 2]);
    expect(mapPagesToSlides(null, 3, 3)).toEqual([0, 1, 2]);
    expect(mapPagesToSlides(["i", "ii", "iii"], 3, 3)).toEqual([0, 1, 2]);
    expect(mapPagesToSlides(null, 5, 3)).toBeNull();
    expect(mapPagesToSlides(["1", "3", "2"], 3, 2)).toBeNull();
  });
});
