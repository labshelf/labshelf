/** Verifies the Typst heading scanner finds headings in document order and skips non-heading text. */
import { scanTypstHeadings } from "../../../../src/writing/typst/source/index";

const FENCE = "```";

describe("scanTypstHeadings", () => {
  it("returns no headings for empty text", () => {
    expect(scanTypstHeadings("")).toEqual([]);
  });

  it("reads levels and zero-based lines from = markers", () => {
    expect(scanTypstHeadings("= Intro\ntext\n== Method\n=== Detail")).toEqual([
      { level: 1, title: "Intro", line: 0 },
      { level: 2, title: "Method", line: 2 },
      { level: 3, title: "Detail", line: 3 },
    ]);
  });

  it("allows leading spaces and tabs before the marker", () => {
    expect(scanTypstHeadings("  = A\n\t== B")).toEqual([
      { level: 1, title: "A", line: 0 },
      { level: 2, title: "B", line: 1 },
    ]);
  });

  it("collapses inner whitespace and trims the title", () => {
    expect(scanTypstHeadings("=   Many   spaced \t words  ")).toEqual([
      { level: 1, title: "Many spaced words", line: 0 },
    ]);
  });

  it("requires whitespace and a title after the marker", () => {
    expect(scanTypstHeadings("=Intro\n==\n== \na = b")).toEqual([]);
  });

  it("drops a trailing label from the title", () => {
    expect(scanTypstHeadings("= Intro <sec:intro>")).toEqual([{ level: 1, title: "Intro", line: 0 }]);
  });

  it("ignores headings inside fenced raw blocks and resumes after the fence", () => {
    const text = `= Before\n${FENCE}typ\n= Hidden\n${FENCE}\n= After`;
    expect(scanTypstHeadings(text)).toEqual([
      { level: 1, title: "Before", line: 0 },
      { level: 1, title: "After", line: 4 },
    ]);
  });

  it("ignores headings inside a longer fence", () => {
    const text = "````\n= Hidden\n````\n= Shown";
    expect(scanTypstHeadings(text)).toEqual([{ level: 1, title: "Shown", line: 3 }]);
  });

  it("ignores headings inside multi-line block comments", () => {
    expect(scanTypstHeadings("/*\n= Hidden\n*/\n= Shown")).toEqual([{ level: 1, title: "Shown", line: 3 }]);
  });

  it("treats nested block comments as one comment", () => {
    const text = "/* a /* b */\n= still comment */\n= Shown";
    expect(scanTypstHeadings(text)).toEqual([{ level: 1, title: "Shown", line: 2 }]);
  });

  it("does not treat a line comment as a heading", () => {
    expect(scanTypstHeadings("// = x")).toEqual([]);
  });

  it("keeps the full title when a URL contains //", () => {
    expect(scanTypstHeadings("= See https://x.org")).toEqual([{ level: 1, title: "See https://x.org", line: 0 }]);
  });

  it("reads #heading calls with and without a level", () => {
    expect(scanTypstHeadings("#heading[Results]\n  #heading(level: 2)[More]")).toEqual([
      { level: 1, title: "Results", line: 0 },
      { level: 2, title: "More", line: 1 },
    ]);
  });
});
