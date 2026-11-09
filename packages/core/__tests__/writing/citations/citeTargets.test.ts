/** Verifies the targets a citation of one paper can point at, the single-key citation at the cursor and how it is rewritten. */
import type { Annotation } from "../../../src/model/index";
import { parseItemFile } from "../../../src/qmd/index";
import { deriveCitedKeyContext, listCardNotes, listCiteTargets, PAGE_SLOT, rewriteCitation } from "../../../src/writing/citations/index";

const highlight = (id: string, page: number, content: string): Annotation => ({
  id, paperId: "p", type: "highlight", pageNumber: page, content, createdAt: "2026-01-01", updatedAt: "2026-01-01",
});

describe("listCiteTargets", () => {
  it("lists the whole paper, a page, then highlights and notes by page with notes anchored nowhere last", () => {
    const notes = parseItemFile([
      "::: {#n1 .labshelf-item anchor=\"p7 point 0.5 0.5\"}", "Main claim of the paper", ":::", "",
      "::: {#n2 .labshelf-item}", "Loose thought", ":::", "",
      "::: {#n3 .labshelf-item anchor=\"hl:h1\"}", "On the highlight", ":::", "",
    ].join("\n"));
    const targets = listCiteTargets([highlight("h1", 3, " Attention is all "), highlight("h2", 9, "  ")], notes);
    expect(targets.map((target) => [target.kind, "page" in target ? target.page : undefined])).toEqual([
      ["paper", undefined], ["page", undefined],
      ["highlight", 3], ["highlight", 3], ["note", 3], ["note", 3],
      ["note", 7], ["note", 7], ["note", undefined], ["note", undefined],
    ]);
    expect(targets[2]).toEqual({ kind: "highlight", page: 3, text: "Attention is all", quote: false });
  });
});

describe("deriveCitedKeyContext", () => {
  it("finds a single-key LaTeX citation whose key ends at the cursor, keeping the command", () => {
    expect(deriveCitedKeyContext("latex", "see \\citep{smith2020", "} and")).toEqual({ key: "smith2020", commandStart: 4, commandEnd: 21, command: "\\citep" });
  });

  it("leaves out citations with several keys, a page argument or the cursor inside the key", () => {
    expect(deriveCitedKeyContext("latex", "\\cite{a,b", "}")).toBeUndefined();
    expect(deriveCitedKeyContext("latex", "\\cite[p.~2]{a", "}")).toBeUndefined();
    expect(deriveCitedKeyContext("typst", "@smi", "th20")).toBeUndefined();
    expect(deriveCitedKeyContext("typst", "@smith", "[p. 2]")).toBeUndefined();
  });

  it("finds Typst references and #cite calls", () => {
    expect(deriveCitedKeyContext("typst", "as @smith2020", " says")).toEqual({ key: "smith2020", commandStart: 3, commandEnd: 13, command: "@" });
    expect(deriveCitedKeyContext("typst", "#cite(<smith", ">)")).toEqual({ key: "smith", commandStart: 0, commandEnd: 14, command: "#cite" });
  });
});

describe("rewriteCitation", () => {
  const latex = { key: "k", commandStart: 0, commandEnd: 8, command: "\\citep" };
  const typst = { key: "k", commandStart: 0, commandEnd: 2, command: "@" };

  it("writes the page, quotation and note text in each format", () => {
    expect(rewriteCitation("latex", latex, { kind: "paper" })).toBeUndefined();
    expect(rewriteCitation("latex", latex, { kind: "page" })).toBe(`\\citep[p.~${PAGE_SLOT}]{k}`);
    expect(rewriteCitation("latex", latex, { kind: "highlight", page: 4, text: "50% gain", quote: true })).toBe("``50\\% gain''~\\citep[p.~4]{k}");
    expect(rewriteCitation("latex", latex, { kind: "note", text: "my_idea", withText: true })).toBe("my\\_idea~\\citep{k}");
    expect(rewriteCitation("typst", typst, { kind: "note", text: "idea", page: 2, withText: false })).toBe("@k[p. 2]");
    expect(rewriteCitation("typst", { ...typst, command: "#cite" }, { kind: "highlight", page: 4, text: "x", quote: false })).toBe("#cite(<k>, supplement: [p. 4])");
  });
});

describe("listCardNotes", () => {
  const notes = parseItemFile([
    "::: {#a .labshelf-item anchor=\"p9 point 0.5 0.5\"}", "Late", ":::", "",
    "::: {#b .labshelf-item}", "Loose", ":::", "",
    "::: {#c .labshelf-item anchor=\"p2 point 0.5 0.5\"}", "Early\nsecond line", ":::", "",
    "::: {#d .labshelf-item anchor=\"p5 point 0.5 0.5\"}", "Middle", ":::", "",
  ].join("\n"));

  it("lists the first line of each note by page, notes without a page last, up to the limit", () => {
    expect(listCardNotes(notes, [], 3)).toEqual([{ text: "Early", page: 2 }, { text: "Middle", page: 5 }, { text: "Late", page: 9 }]);
  });

  it("puts the cited page's notes first", () => {
    expect(listCardNotes(notes, [], 2, 9)).toEqual([{ text: "Late", page: 9 }, { text: "Early", page: 2 }]);
  });

  it("is empty without a notes file", () => {
    expect(listCardNotes(undefined, [], 3)).toEqual([]);
  });
});
