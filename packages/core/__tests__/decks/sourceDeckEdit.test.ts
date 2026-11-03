// Slide and block insertion, speaker notes and size changes on LaTeX and Typst talks and posters.
import { insertSourceBlock, insertSourceNote, insertSourceSlide, readSourceDeckShape, setSourceDeckShape } from "../../src/decks/sourceDeckEdit.js";
import { readSourceDeckNotes, readSourceDeckOutline } from "../../src/decks/sourceDeckOutline.js";
import { listSourceDeckShapes, scaffoldSourceDeck } from "../../src/decks/sourceDeckScaffold.js";

const beamer = scaffoldSourceDeck("latex", "T", { kind: "talk", aspect: "16:9" });
const typstTalk = scaffoldSourceDeck("typst", "T", { kind: "talk", aspect: "16:9" });
const titles = (format: "latex" | "typst", text: string): string[] => readSourceDeckOutline(format, "talk", text).map((s) => s.title);

describe("insertSourceSlide", () => {
  it("adds a Beamer slide after the slide at the cursor, the cursor on its title", () => {
    const at = beamer.indexOf("Motivation");
    const { text, cursor } = insertSourceSlide("latex", beamer, at, "two-columns");
    expect(titles("latex", text)).toEqual(["Title page", "Motivation", "Title", "Results", "Conclusion"]);
    expect(text.slice(cursor, cursor + 5)).toBe("Title");
    expect(text).toContain("\\begin{columns}");
  });

  it("adds a Typst heading slide after the current one", () => {
    const { text } = insertSourceSlide("typst", typstTalk, typstTalk.indexOf("== Results"), "figure");
    expect(titles("typst", text)).toEqual(["Motivation", "Results", "Title", "Conclusion"]);
  });

  it("adds a Typst #slide call in a source written with them", () => {
    const source = "#slide[\n  == One\n]\n";
    const { text } = insertSourceSlide("typst", source, 2, "bullets");
    expect(text).toContain("#slide[\n  == Title");
    expect(titles("typst", text)).toEqual(["One", "Title"]);
  });

  it("puts the first slide of an empty Beamer document before \\end{document}", () => {
    const { text } = insertSourceSlide("latex", "\\begin{document}\n\\end{document}\n", 0, "equation");
    expect(text.indexOf("\\begin{frame}")).toBeLessThan(text.indexOf("\\end{document}"));
  });
});

describe("insertSourceBlock", () => {
  it("writes a tikzposter \\block, a beamerposter block, a Typst heading block", () => {
    const tikz = scaffoldSourceDeck("latex", "T", { kind: "poster", size: { w: 841, h: 1189, unit: "mm" }, paper: "a0" });
    expect(insertSourceBlock("latex", tikz, tikz.indexOf("\\block{Method}"), "list").text).toContain("\\block{Title}{\n    \\begin{itemize}");
    const beamerPoster = "\\documentclass{beamer}\n\\usepackage{beamerposter}\n";
    expect(insertSourceBlock("latex", beamerPoster, 0, "text").text).toContain("\\begin{block}{Title}");
    expect(insertSourceBlock("typst", "= Intro\n", 0, "equation").text).toContain("= Title\n$ E = m c^2 $");
  });
});

describe("insertSourceNote", () => {
  it("adds a note to the Beamer slide at the cursor, read back as that slide's notes", () => {
    const at = beamer.indexOf("Results");
    const change = insertSourceNote("latex", beamer, at)!;
    const text = change.text.slice(0, change.cursor) + "Pause here" + change.text.slice(change.cursor);
    expect(readSourceDeckNotes("latex", text)[2]).toBe("Pause here");
  });

  it("adds a Typst speaker note and gives null outside any slide", () => {
    const change = insertSourceNote("typst", typstTalk, typstTalk.indexOf("== Conclusion"))!;
    expect(change.text.slice(change.cursor - 14, change.cursor + 1)).toBe("#speaker-note[]");
    expect(insertSourceNote("latex", beamer, 0)).toBeNull();
  });
});

describe("source deck shapes", () => {
  it("rewrites and reads the Beamer aspect ratio", () => {
    const four = setSourceDeckShape("latex", beamer, { kind: "talk", aspect: "4:3" })!;
    expect(four).toContain("\\documentclass[aspectratio=43]{beamer}");
    expect(readSourceDeckShape("latex", "talk", four)).toBe("4:3");
    expect(readSourceDeckShape("latex", "talk", beamer)).toBe("16:9");
  });

  it("rewrites and reads a tikzposter's paper and orientation", () => {
    const tikz = scaffoldSourceDeck("latex", "T", { kind: "poster", size: { w: 841, h: 1189, unit: "mm" }, paper: "a0" });
    const a1 = listSourceDeckShapes("poster", "latex").find((c) => c.label === "A1 landscape")!.shape;
    const next = setSourceDeckShape("latex", tikz, a1)!;
    expect(next).toContain("a1paper");
    expect(next).toContain("landscape");
    expect(next).not.toContain("a0paper");
    expect(readSourceDeckShape("latex", "poster", next)).toBe("A1 landscape");
  });

  it("rewrites beamerposter options", () => {
    const text = "\\documentclass{beamer}\n\\usepackage[orientation=portrait,size=a0,scale=1.4]{beamerposter}\n";
    const a2 = listSourceDeckShapes("poster", "latex").find((c) => c.label === "A2 landscape")!.shape;
    const next = setSourceDeckShape("latex", text, a2)!;
    expect(next).toContain("\\usepackage[scale=1.4, size=a2, orientation=landscape]{beamerposter}");
    expect(readSourceDeckShape("latex", "poster", next)).toBe("A2 landscape");
  });

  it("rewrites and reads a Typst page", () => {
    const poster = scaffoldSourceDeck("typst", "T", { kind: "poster", size: { w: 841, h: 1189, unit: "mm" } });
    expect(readSourceDeckShape("typst", "poster", poster)).toBe("A0 portrait");
    const arch = listSourceDeckShapes("poster", "typst").find((c) => c.label === "ARCH E landscape")!.shape;
    const next = setSourceDeckShape("typst", poster, arch)!;
    expect(next).toContain("#set page(width: 48in, height: 36in, margin: 3cm)");
    expect(readSourceDeckShape("typst", "talk", setSourceDeckShape("typst", typstTalk, { kind: "talk", aspect: "4:3" })!)).toBe("4:3");
  });
});
