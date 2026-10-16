// Derives the one-line fact shown beside a paper's files and its note row in the library tray.
import type { PaperRecord } from "../../../../src/model";
import type { PaperFile, PaperStats } from "../../../../src/library-ui";
import { noteFact, paperFileFact } from "../../../../src/library-ui/derive/facts";

const record = (extra: Partial<PaperRecord> = {}) => ({ id: "p", title: "T", ...extra }) as PaperRecord;
const pdf: PaperFile = { name: "paper.pdf", kind: "file", size: 1, modified: "2026-01-01T00:00:00.000Z" };
const stats = (lastHighlight?: PaperStats["lastHighlight"]): PaperStats => ({ annotations: 1, ...(lastHighlight ? { lastHighlight } : {}) });

describe("paperFileFact for paper.pdf", () => {
  it("shows the page and text of the last highlight", () => {
    expect(paperFileFact(record({ summary: "Ignored." }), stats({ page: 4, text: "a key claim" }), pdf)).toBe("p. 4 · a key claim");
  });

  it.each([
    ["ends at a period before whitespace", "First one. Second one.", "First one."],
    ["ends at a question mark", "Does it work? Yes.", "Does it work?"],
    ["ends at an exclamation mark", "It works! Really.", "It works!"],
    ["ends at a terminator at the end", "Only one.", "Only one."],
    ["keeps the whole text without a terminator", "No terminator here", "No terminator here"],
    ["does not end inside a number", "Costs 3.5 dollars. More.", "Costs 3.5 dollars."],
    ["does not special-case abbreviations", "See Dr. Smith for more. End.", "See Dr."],
    ["trims the result", "  Padded text.  Next.  ", "Padded text."],
  ])("falls back to the abstract's first sentence: %s", (_name, summary, expected) => {
    expect(paperFileFact(record({ summary }), stats(), pdf)).toBe(expected);
  });

  it("uses the abstract when stats are missing", () => {
    expect(paperFileFact(record({ summary: "Abstract here. More." }), undefined, pdf)).toBe("Abstract here.");
  });

  it.each([[undefined], [""], ["   "]])("is empty without highlight or abstract (%j)", (summary) => {
    expect(paperFileFact(record(summary === undefined ? {} : { summary }), stats(), pdf)).toBe("");
  });
});

describe("noteFact", () => {
  it("shows the start of the note", () => {
    expect(noteFact(record({ note: "  Check the method.\nSecond line" }))).toBe("Check the method. Second line");
  });

  it("collapses whitespace runs", () => {
    expect(noteFact(record({ note: "a \t b\n\n\nc" }))).toBe("a b c");
  });

  it("caps a long note at about 120 characters with an ellipsis", () => {
    const fact = noteFact(record({ note: "word ".repeat(100) }));
    expect(fact.endsWith("…")).toBe(true);
    expect(fact.length).toBeLessThanOrEqual(122);
    expect(fact.length).toBeGreaterThan(100);
  });

  it("does not add an ellipsis to a short note", () => {
    expect(noteFact(record({ note: "short" }))).toBe("short");
  });

  it.each([[undefined], [""], [" \n\t "]])('says "Empty" for a missing or blank note (%j)', (note) => {
    expect(noteFact(record(note === undefined ? {} : { note }))).toBe("Empty");
  });
});

describe("paperFileFact for other entries", () => {
  const other = (extra: Partial<PaperFile>): PaperFile => ({ name: "data.csv", kind: "file", size: 3, modified: "2026-01-01T00:00:00.000Z", ...extra });

  it("shows the description of a file", () => {
    expect(paperFileFact(record({ summary: "Abstract." }), stats({ page: 1, text: "x" }), other({ description: "Raw measurements" }))).toBe("Raw measurements");
  });

  it("shows the description of a subfolder", () => {
    expect(paperFileFact(record(), undefined, { name: "src", kind: "folder", modified: "2026-01-01T00:00:00.000Z", description: "Source code" })).toBe("Source code");
  });

  it("is empty without a description, whatever the abstract says", () => {
    expect(paperFileFact(record({ summary: "Abstract." }), stats(), other({}))).toBe("");
  });
});
