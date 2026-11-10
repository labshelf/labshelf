/** Verifies the citation scope store: reading and writing .labshelf/citations.json, anchoring a citation, resolving an occurrence after edits, re-anchoring on save and the citation text of each scope. */
import type { Annotation } from "../../../src/model/index";
import { parseItemFile } from "../../../src/qmd/index";
import {
  CITATION_SCOPES_FILE, createScopedCitation, findCiteKeyOccurrences, formatCitationScopes, parseCitationScopes, pruneCitationScopes,
  reanchorCitationScopes, recordCitationScope, resolveCitationScope, type CitationScope, type CitationScopeRecord,
} from "../../../src/writing/citations/index";

const FILE = "chapters/intro.tex";

/** A record for the command that holds the n-th occurrence of `key` in `text`. */
function recordAt(text: string, key: string, nth: number, scope: CitationScope, id: string, createdAt = "2026-01-01T00:00:00Z"): CitationScopeRecord {
  const occurrence = findCiteKeyOccurrences("latex", text).filter((each) => each.key === key)[nth]!;
  const start = text.lastIndexOf(occurrence.command, occurrence.start);
  return recordCitationScope(text, { start, end: start + occurrence.command.length }, { id, file: FILE, key, scope, createdAt });
}

const occurrenceOf = (text: string, key: string, nth: number) => findCiteKeyOccurrences("latex", text).filter((each) => each.key === key)[nth]!;

describe("CITATION_SCOPES_FILE", () => {
  it("lives in the project's .labshelf folder", () => {
    expect(CITATION_SCOPES_FILE).toBe(".labshelf/citations.json");
  });
});

describe("recordCitationScope", () => {
  it("quotes the command and keeps up to 32 characters around it", () => {
    const text = `${"x".repeat(40)} \\cite[p.~4]{smith} ${"y".repeat(40)}`;
    const record = recordAt(text, "smith", 0, { kind: "page", page: 4 }, "r1");
    expect(record.anchor).toEqual({ quote: "\\cite[p.~4]{smith}", prefix: `${"x".repeat(31)} `, suffix: ` ${"y".repeat(31)}` });
    expect(record).toMatchObject({ id: "r1", file: FILE, key: "smith", scope: { kind: "page", page: 4 } });
  });

  it("cuts a passage to 2000 characters", () => {
    const text = "see \\cite[p.~2]{smith}.";
    const record = recordAt(text, "smith", 0, { kind: "passage", page: 2, text: "a".repeat(2500) }, "r1");
    expect(record.scope).toEqual({ kind: "passage", page: 2, text: "a".repeat(2000) });
  });
});

describe("parseCitationScopes and formatCitationScopes", () => {
  const text = "A \\cite{a} and \\cite[p.~3]{b,c}.";
  const records: CitationScopeRecord[] = [
    recordAt(text, "a", 0, { kind: "paper" }, "r1"),
    recordAt(text, "b", 0, { kind: "page", page: 3 }, "r2"),
    recordAt(text, "c", 0, { kind: "highlight", annotationId: "h1", page: 3 }, "r3"),
    recordAt(text, "a", 0, { kind: "passage", page: 1, text: "Quoted words" }, "r4"),
    recordAt(text, "a", 0, { kind: "note", noteId: "n1", page: 7 }, "r5"),
    recordAt(text, "a", 0, { kind: "note", noteId: "n2" }, "r6"),
  ];

  it("round-trips every kind of scope", () => {
    const written = formatCitationScopes(records);
    expect(JSON.parse(written)).toMatchObject({ version: 1 });
    expect(parseCitationScopes(written)).toEqual(records);
  });

  it("skips malformed records with a warning and keeps the rest", () => {
    const warnings: unknown[] = [];
    const logger = { log: async (...args: unknown[]) => { warnings.push(args); }, error: async () => {} };
    const raw = JSON.parse(formatCitationScopes(records.slice(0, 2)));
    raw.citations.push(
      { ...raw.citations[0], id: "" },
      { ...raw.citations[0], id: "x1", scope: { kind: "page" } },
      { ...raw.citations[0], id: "x2", scope: { kind: "chapter", page: 1 } },
      { ...raw.citations[0], id: "x3", anchor: { quote: "", prefix: "", suffix: "" } },
      { ...raw.citations[0], id: "x4", createdAt: "yesterday" },
      "not a record",
    );
    expect(parseCitationScopes(JSON.stringify(raw), logger)).toEqual(records.slice(0, 2));
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toEqual(expect.arrayContaining(["WARN"]));
  });

  it("reads nothing, without throwing, from bad JSON, an unknown version or a missing list", () => {
    const logger = { log: jest.fn(async () => {}), error: async () => {} };
    expect(parseCitationScopes("{not json", logger)).toEqual([]);
    expect(parseCitationScopes(JSON.stringify({ version: 2, citations: [] }), logger)).toEqual([]);
    expect(parseCitationScopes(JSON.stringify({ version: 1 }), logger)).toEqual([]);
    expect(parseCitationScopes("")).toEqual([]);
    expect(logger.log).toHaveBeenCalledTimes(3);
  });
});

describe("resolveCitationScope", () => {
  const before = "Intro \\cite{smith} middle text \\cite{smith} end.";
  const first = recordAt(before, "smith", 0, { kind: "page", page: 1 }, "first");
  const second = recordAt(before, "smith", 1, { kind: "page", page: 2 }, "second");

  it("finds the record of each occurrence after edits before and after it", () => {
    const after = "New opening. Intro \\cite{smith} middle text, longer \\cite{smith} end, and more.";
    expect(resolveCitationScope([first, second], FILE, after, occurrenceOf(after, "smith", 0))?.id).toBe("first");
    expect(resolveCitationScope([first, second], FILE, after, occurrenceOf(after, "smith", 1))?.id).toBe("second");
  });

  it("tells apart two citations of the same key on one line", () => {
    const line = "See \\cite{k} here and \\cite{k} there.";
    const a = recordAt(line, "k", 0, { kind: "paper" }, "a");
    const b = recordAt(line, "k", 1, { kind: "page", page: 9 }, "b");
    const edited = `Now: ${line.replace("here", "right here")}`;
    expect(resolveCitationScope([b, a], FILE, edited, occurrenceOf(edited, "k", 0))?.id).toBe("a");
    expect(resolveCitationScope([b, a], FILE, edited, occurrenceOf(edited, "k", 1))?.id).toBe("b");
  });

  it("resolves a multi-key command per key", () => {
    const text = "As shown \\cite{a,b}.";
    const forB = recordAt(text, "b", 0, { kind: "page", page: 5 }, "forB");
    expect(resolveCitationScope([forB], FILE, text, occurrenceOf(text, "a", 0))).toBeUndefined();
    expect(resolveCitationScope([forB], FILE, text, occurrenceOf(text, "b", 0))?.id).toBe("forB");
  });

  it("prefers the newest record when several cover the occurrence", () => {
    const text = "x \\cite{a} y";
    const old = recordAt(text, "a", 0, { kind: "paper" }, "old", "2026-01-01T00:00:00Z");
    const fresh = recordAt(text, "a", 0, { kind: "page", page: 2 }, "fresh", "2026-02-01T00:00:00Z");
    expect(resolveCitationScope([fresh, old], FILE, text, occurrenceOf(text, "a", 0))?.id).toBe("fresh");
    expect(resolveCitationScope([old, fresh], FILE, text, occurrenceOf(text, "a", 0))?.id).toBe("fresh");
  });

  it("gives nothing for another file, a citation without a record, or a removed citation", () => {
    const text = "x \\cite{a} y \\cite{b}";
    const record = recordAt(text, "a", 0, { kind: "paper" }, "r");
    expect(resolveCitationScope([record], "other.tex", text, occurrenceOf(text, "a", 0))).toBeUndefined();
    expect(resolveCitationScope([record], FILE, text, occurrenceOf(text, "b", 0))).toBeUndefined();
    const removed = "x y \\cite{b}";
    expect(resolveCitationScope([record], FILE, removed, occurrenceOf(removed, "b", 0))).toBeUndefined();
  });
});

describe("reanchorCitationScopes", () => {
  const text = "Intro \\cite{smith} middle \\cite{doe} end.";
  const smith = recordAt(text, "smith", 0, { kind: "page", page: 1 }, "smith");
  const doe = recordAt(text, "doe", 0, { kind: "paper" }, "doe");
  const elsewhere: CitationScopeRecord = { ...doe, id: "elsewhere", file: "other.tex" };

  it("rewrites the context after edits and keeps the occurrence resolvable", () => {
    const edited = "A whole new first paragraph.\n\nIntro, revised: \\cite{smith} middle part \\cite{doe} end.";
    const next = reanchorCitationScopes([smith, doe, elsewhere], FILE, edited, "latex");
    const mine = next.find((each) => each.id === "smith")!;
    expect(mine.anchor).toEqual({ quote: "\\cite{smith}", prefix: "w first paragraph.\n\nIntro, revised: ".slice(-32), suffix: " middle part \\cite{doe} end." });
    expect(next.find((each) => each.id === "elsewhere")).toBe(elsewhere);
    expect(resolveCitationScope(next, FILE, edited, occurrenceOf(edited, "smith", 0))?.id).toBe("smith");
    expect(resolveCitationScope(next, FILE, edited, occurrenceOf(edited, "doe", 0))?.id).toBe("doe");
  });

  it("keeps a command whose page argument changed", () => {
    const edited = "Intro \\cite[p.~3]{smith} middle \\cite{doe} end.";
    const mine = reanchorCitationScopes([smith], FILE, edited, "latex")[0]!;
    expect(mine.anchor.quote).toBe("\\cite[p.~3]{smith}");
  });

  it("drops a record whose command lost its key or is gone", () => {
    const edited = "Intro \\cite{smyth} middle end.";
    expect(reanchorCitationScopes([smith, doe, elsewhere], FILE, edited, "latex").map((each) => each.id)).toEqual(["elsewhere"]);
  });

  it("works on Typst citations", () => {
    const typst = "Intro @smith[p. 2] middle.";
    const start = typst.indexOf("@smith");
    const record = recordCitationScope(typst, { start, end: start + "@smith".length }, { id: "t", file: "main.typ", key: "smith", scope: { kind: "page", page: 2 }, createdAt: "2026-01-01T00:00:00Z" });
    const edited = `Opening. ${typst}`;
    expect(reanchorCitationScopes([record], "main.typ", edited, "typst")[0]!.anchor.prefix).toBe("Opening. Intro ");
    expect(reanchorCitationScopes([record], "main.typ", "Intro middle.", "typst")).toEqual([]);
  });
});

describe("pruneCitationScopes", () => {
  it("drops the records of files that no longer exist", () => {
    const text = "x \\cite{a}";
    const kept = recordAt(text, "a", 0, { kind: "paper" }, "kept");
    const gone: CitationScopeRecord = { ...kept, id: "gone", file: "deleted.tex" };
    expect(pruneCitationScopes([kept, gone], new Set([FILE]))).toEqual([kept]);
  });
});

describe("createScopedCitation", () => {
  const annotations: Annotation[] = [{ id: "h1", paperId: "p", type: "highlight", pageNumber: 4, content: "Attention is all you need", createdAt: "2026-01-01", updatedAt: "2026-01-01" }];
  const notes = parseItemFile(['::: {#n1 .labshelf-item anchor="p7 point 0.5 0.5"}', "My own reading", ":::", ""].join("\n"));
  const lookups = { annotations, notes };
  const cases: [CitationScope, boolean, string, string][] = [
    [{ kind: "paper" }, false, "\\cite{k}", "@k"],
    [{ kind: "paper" }, true, "\\cite{k}", "@k"],
    [{ kind: "page", page: 3 }, true, "\\cite[p.~3]{k}", "@k[p. 3]"],
    [{ kind: "highlight", annotationId: "h1", page: 4 }, false, "\\cite[p.~4]{k}", "@k[p. 4]"],
    [{ kind: "highlight", annotationId: "h1", page: 4 }, true, "``Attention is all you need''~\\cite[p.~4]{k}", "\"Attention is all you need\" @k[p. 4]"],
    [{ kind: "passage", page: 2, text: "Cut $5" }, false, "\\cite[p.~2]{k}", "@k[p. 2]"],
    [{ kind: "passage", page: 2, text: "Cut $5" }, true, "``Cut \\$5''~\\cite[p.~2]{k}", "\"Cut \\$5\" @k[p. 2]"],
    [{ kind: "note", noteId: "n1", page: 7 }, false, "\\cite[p.~7]{k}", "@k[p. 7]"],
    [{ kind: "note", noteId: "n1", page: 7 }, true, "``My own reading''~\\cite[p.~7]{k}", "\"My own reading\" @k[p. 7]"],
    [{ kind: "note", noteId: "n9" }, true, "\\cite{k}", "@k"],
    [{ kind: "highlight", annotationId: "gone", page: 5 }, true, "\\cite[p.~5]{k}", "@k[p. 5]"],
  ];

  it.each(cases)("writes %j (quoted %s) in LaTeX and Typst", (scope, quoted, latex, typst) => {
    expect(createScopedCitation("latex", "k", scope, quoted, lookups)).toBe(latex);
    expect(createScopedCitation("typst", "k", scope, quoted, lookups)).toBe(typst);
  });
});
