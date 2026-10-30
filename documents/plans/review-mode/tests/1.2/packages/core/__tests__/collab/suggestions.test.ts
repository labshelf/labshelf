/**
 * Verifies suggestion records: validation, anchors, re-finding in changed text, the text of an accept or reject.
 * Verifies that suggestion items round-trip through comments.qmd beside comment threads and that adding or removing suggestions changes nothing else.
 */
import * as Y from "yjs";
import { deriveLiveAnchor, type CommentThread } from "../../src/collab/comments";
import { parseCommentsQmd, serializeCommentsQmd } from "../../src/collab/commentsQmd";
import { addSuggestions, deriveSuggestions, deriveCommentThreads, removeSuggestions } from "../../src/collab/commentsFile";
import * as collab from "../../src/collab/index";
import {
  deriveSuggestionAnchor, findSuggestion, readSuggestion, resolveSuggestionText, type Suggestion,
} from "../../src/collab/suggestions";

const BASE = [
  "Introduction paragraph that sets the scene for the reader.",
  "We use a strong baseline and compare it against the new method on three datasets.",
  "The closing paragraph summarises what the reader should take away from this section.",
].join("\n");

const CREATED = "2026-10-20T08:00:00.000Z";

function insertSuggestion(text: string, quote: string, overrides: Partial<Suggestion> = {}): Suggestion {
  const start = text.indexOf(quote);
  expect(start).toBeGreaterThanOrEqual(0);
  return {
    id: "s-ins", file: "main.tex", kind: "insert", anchor: deriveSuggestionAnchor(text, "insert", start, start + quote.length),
    author: "Ana", created: CREATED, ...overrides,
  };
}

function deleteSuggestion(text: string, at: number, removed: string, overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id: "s-del", file: "main.tex", kind: "delete", anchor: deriveSuggestionAnchor(text, "delete", at, at),
    text: removed, author: "Bo", created: CREATED, ...overrides,
  };
}

function validInsert(): Record<string, unknown> {
  return { id: "s1", file: "main.tex", kind: "insert", anchor: { quote: "new words", prefix: "before ", suffix: " after" }, author: "Ana", created: CREATED };
}

function validDelete(): Record<string, unknown> {
  return { id: "s2", file: "main.tex", kind: "delete", anchor: { quote: "", prefix: "before ", suffix: " after" }, text: "gone words", author: "Bo", created: CREATED };
}

describe("deriveSuggestionAnchor", () => {
  it("1.2b quotes the range of an insert with context around it", () => {
    const start = BASE.indexOf("a strong baseline");
    const end = start + "a strong baseline".length;
    const anchor = deriveSuggestionAnchor(BASE, "insert", start, end);
    expect(anchor.quote).toBe("a strong baseline");
    expect(anchor.prefix).toBe(BASE.slice(start - 32, start));
    expect(anchor.suffix).toBe(BASE.slice(end, end + 32));
  });

  it("1.2b gives a delete an empty quote at start and ignores end", () => {
    const at = BASE.indexOf("compare");
    const anchor = deriveSuggestionAnchor(BASE, "delete", at, at + 500);
    expect(anchor.quote).toBe("");
    expect(anchor.prefix).toBe(BASE.slice(at - 32, at));
    expect(anchor.suffix).toBe(BASE.slice(at, at + 32));
  });

  it("1.2b keeps short context at the start of the text", () => {
    const anchor = deriveSuggestionAnchor("Hello world", "delete", 0, 0);
    expect(anchor).toEqual({ quote: "", prefix: "", suffix: "Hello world" });
  });
});

describe("readSuggestion", () => {
  it("1.2a accepts a valid insert", () => {
    expect(readSuggestion(validInsert())).toEqual(validInsert());
  });

  it("1.2a accepts a valid delete", () => {
    expect(readSuggestion(validDelete())).toEqual(validDelete());
  });

  it("1.2a keeps the group of a suggestion", () => {
    expect(readSuggestion({ ...validInsert(), group: "g1" })?.group).toBe("g1");
  });

  it("1.2a keeps the relative positions of an anchor", () => {
    const anchor = { quote: "new words", prefix: "before ", suffix: " after", start: "AQID", end: "BAUG" };
    expect(readSuggestion({ ...validInsert(), anchor })?.anchor).toEqual(anchor);
  });

  it("1.2a rejects what is not a record", () => {
    for (const value of [undefined, null, "text", 3, [], true]) { expect(readSuggestion(value)).toBeUndefined(); }
  });

  it.each([
    ["a missing id", { id: undefined }],
    ["an empty id", { id: "" }],
    ["a non-string id", { id: 4 }],
    ["a missing file", { file: undefined }],
    ["an empty file", { file: "" }],
    ["an unknown kind", { kind: "replace" }],
    ["a missing kind", { kind: undefined }],
    ["a missing anchor", { anchor: undefined }],
    ["an anchor that is not a record", { anchor: "quote" }],
    ["an anchor without a prefix", { anchor: { quote: "new words", suffix: " after" } }],
    ["an anchor without a suffix", { anchor: { quote: "new words", prefix: "before " } }],
    ["an insert with an empty quote", { anchor: { quote: "", prefix: "before ", suffix: " after" } }],
    ["an insert with a text", { text: "extra" }],
    ["a missing author", { author: undefined }],
    ["an empty author", { author: "" }],
    ["a missing created", { created: undefined }],
    ["an empty created", { created: "" }],
  ])("1.2a rejects an insert with %s", (_name, change) => {
    expect(readSuggestion({ ...validInsert(), ...change })).toBeUndefined();
  });

  it.each([
    ["a missing text", { text: undefined }],
    ["an empty text", { text: "" }],
    ["a non-string text", { text: 5 }],
    ["a quote that is not empty", { anchor: { quote: "gone words", prefix: "before ", suffix: " after" } }],
    ["a missing id", { id: undefined }],
    ["an empty file", { file: "" }],
    ["an unknown kind", { kind: "remove" }],
    ["an anchor without a suffix", { anchor: { quote: "", prefix: "before " } }],
    ["an empty author", { author: "" }],
    ["an empty created", { created: "" }],
  ])("1.2a rejects a delete with %s", (_name, change) => {
    expect(readSuggestion({ ...validDelete(), ...change })).toBeUndefined();
  });

  it("1.2a accepts a delete with empty prefix and suffix context", () => {
    expect(readSuggestion({ ...validDelete(), anchor: { quote: "", prefix: "", suffix: "" } })).toBeDefined();
  });
});

describe("findSuggestion", () => {
  it("1.2b finds an insert in the text it was derived from", () => {
    const suggestion = insertSuggestion(BASE, "a strong baseline");
    const start = BASE.indexOf("a strong baseline");
    expect(findSuggestion(suggestion, BASE)).toEqual({ start, end: start + "a strong baseline".length });
  });

  it("1.2b finds an insert again after unrelated edits before it", () => {
    const suggestion = insertSuggestion(BASE, "a strong baseline");
    const edited = `A new opening line.\n\n${BASE}`;
    const start = edited.indexOf("a strong baseline");
    expect(findSuggestion(suggestion, edited)).toEqual({ start, end: start + "a strong baseline".length });
  });

  it("1.2b finds the occurrence of an insert whose context matches when the quote repeats", () => {
    const text = "alpha beta gamma. one two three. alpha beta gamma. four five six.";
    const second = text.lastIndexOf("alpha beta gamma");
    const suggestion = insertSuggestion(text, "alpha beta gamma", {
      anchor: deriveSuggestionAnchor(text, "insert", second, second + "alpha beta gamma".length),
    });
    const edited = `Heading\n${text}`;
    const start = edited.lastIndexOf("alpha beta gamma");
    expect(findSuggestion(suggestion, edited)).toEqual({ start, end: start + "alpha beta gamma".length });
  });

  it("1.2b finds a delete as an empty range at its position", () => {
    const at = BASE.indexOf("compare");
    const suggestion = deleteSuggestion(BASE, at, "and ");
    expect(findSuggestion(suggestion, BASE)).toEqual({ start: at, end: at });
  });

  it("1.2b finds a delete again after unrelated edits before it", () => {
    const at = BASE.indexOf("compare");
    const suggestion = deleteSuggestion(BASE, at, "and ");
    const edited = `A new opening line.\n\n${BASE}`;
    const moved = edited.indexOf("compare");
    expect(findSuggestion(suggestion, edited)).toEqual({ start: moved, end: moved });
  });

  it("1.2b finds a delete at the start of the text", () => {
    const suggestion = deleteSuggestion(BASE, 0, "Preface. ");
    const edited = `Title\n${BASE}`;
    const result = findSuggestion(suggestion, BASE);
    expect(result).toEqual({ start: 0, end: 0 });
    expect(findSuggestion(suggestion, edited)).not.toBe("detached");
  });

  it("1.2b finds a delete whose context changed a little", () => {
    const at = BASE.indexOf("compare");
    const suggestion = deleteSuggestion(BASE, at, "and ");
    // One character of the far end of the prefix is different.
    const prefixStart = at - suggestion.anchor.prefix.length;
    const edited = `${BASE.slice(0, prefixStart)}#${BASE.slice(prefixStart + 1)}`;
    expect(findSuggestion(suggestion, edited)).toEqual({ start: at, end: at });
  });

  it("1.2b detaches a delete whose context is gone", () => {
    const at = BASE.indexOf("compare");
    const suggestion = deleteSuggestion(BASE, at, "and ");
    expect(findSuggestion(suggestion, "Completely different words, nothing from before is left here at all.")).toBe("detached");
  });

  it("1.2b detaches a delete in empty text", () => {
    const at = BASE.indexOf("compare");
    expect(findSuggestion(deleteSuggestion(BASE, at, "and "), "")).toBe("detached");
  });

  it("1.2b follows relative positions of an insert in a live text", () => {
    const yDoc = new Y.Doc();
    const yText = yDoc.getText("file");
    yText.insert(0, BASE);
    const start = BASE.indexOf("a strong baseline");
    const end = start + "a strong baseline".length;
    const suggestion = insertSuggestion(BASE, "a strong baseline", { anchor: deriveLiveAnchor(yText, start, end) });
    yText.insert(0, "Peer wrote this. ");
    yText.insert(start + "Peer wrote this. ".length + 4, "!!");
    const shift = "Peer wrote this. ".length;
    expect(findSuggestion(suggestion, yText.toString(), yText)).toEqual({ start: start + shift, end: end + shift + 2 });
  });
});

describe("resolveSuggestionText", () => {
  it("1.2c reject of an insert removes the inserted text", () => {
    const original = "We use  on three datasets.";
    const text = "We use a strong baseline on three datasets.";
    const suggestion = insertSuggestion(text, "a strong baseline");
    const range = findSuggestion(suggestion, text);
    expect(range).not.toBe("detached");
    expect(resolveSuggestionText(text, suggestion, range as { start: number; end: number }, "reject")).toBe(original);
  });

  it("1.2c reject of a delete puts the deleted text back", () => {
    const original = "We compare it against the baseline and the new method.";
    const at = original.indexOf("and the new");
    const text = original.slice(0, at) + original.slice(at + "and the new ".length);
    const suggestion = deleteSuggestion(text, at, "and the new ");
    const range = findSuggestion(suggestion, text);
    expect(range).not.toBe("detached");
    expect(resolveSuggestionText(text, suggestion, range as { start: number; end: number }, "reject")).toBe(original);
  });

  it("1.2c reject of a delete inserts a multi-line text at the range start", () => {
    const text = "head\ntail";
    const suggestion = deleteSuggestion(text, 5, "one\ntwo\n");
    expect(resolveSuggestionText(text, suggestion, { start: 5, end: 5 }, "reject")).toBe("head\none\ntwo\ntail");
  });

  it("1.2c accept of an insert leaves the text", () => {
    const text = "We use a strong baseline on three datasets.";
    const suggestion = insertSuggestion(text, "a strong baseline");
    const start = text.indexOf("a strong baseline");
    expect(resolveSuggestionText(text, suggestion, { start, end: start + 17 }, "accept")).toBe(text);
  });

  it("1.2c accept of a delete leaves the text", () => {
    const text = "We compare it against the baseline.";
    const suggestion = deleteSuggestion(text, 3, "x ");
    expect(resolveSuggestionText(text, suggestion, { start: 3, end: 3 }, "accept")).toBe(text);
  });
});

const thread = (id: string): CommentThread => ({
  id,
  file: "chapters/intro.tex",
  anchor: { quote: "a strong baseline", prefix: "we use ", suffix: " on" },
  comments: [{ id: `${id}-c1`, author: "Ana", body: "Which one?", createdAt: "2026-10-16T09:12:00.000Z" }],
  resolved: false,
});

const sugIns = (id: string, created: string, overrides: Partial<Suggestion> = {}): Suggestion => ({
  id, file: "main.tex", kind: "insert", anchor: { quote: "brand new words", prefix: "so we add ", suffix: " here" }, author: "Ana", created, ...overrides,
});

const sugDel = (id: string, created: string, overrides: Partial<Suggestion> = {}): Suggestion => ({
  id, file: "main.tex", kind: "delete", anchor: { quote: "", prefix: "so we cut ", suffix: " there" }, text: "old words", author: "Bo", created, ...overrides,
});

function parsed(text: string) {
  const doc = parseCommentsQmd(text);
  expect(doc).toBeDefined();
  return doc!;
}

function sortedIds(suggestions: readonly Suggestion[]): string[] {
  return suggestions.map((each) => each.id).sort();
}

describe("suggestions in comments.qmd", () => {
  it("1.2d a document without suggestions has none", () => {
    expect(deriveSuggestions({ threads: [thread("t1")] })).toEqual([]);
  });

  it("1.2d a file without suggestion items parses to no suggestions", () => {
    const text = serializeCommentsQmd({ threads: [thread("t1")] });
    expect(deriveSuggestions(parsed(text))).toEqual([]);
  });

  it("1.2d an insert and a delete round-trip", () => {
    const suggestions = [sugIns("s1", "2026-10-20T08:00:00.000Z"), sugDel("s2", "2026-10-20T09:00:00.000Z")];
    const text = serializeCommentsQmd({ threads: [], suggestions });
    expect(deriveSuggestions(parsed(text))).toEqual(suggestions);
  });

  it("1.2d a delete with a multi-line text round-trips", () => {
    const suggestions = [sugDel("s2", CREATED, { text: "first line\n\nsecond line" })];
    const text = serializeCommentsQmd({ threads: [], suggestions });
    expect(deriveSuggestions(parsed(text))).toEqual(suggestions);
  });

  it("1.2d a group and relative positions round-trip", () => {
    const suggestions = [
      sugDel("s1", "2026-10-20T08:00:00.000Z", { group: "g7" }),
      sugIns("s2", "2026-10-20T08:00:00.000Z", { group: "g7", anchor: { quote: "brand new words", prefix: "so we add ", suffix: " here", start: "AQID", end: "BAUG" } }),
    ];
    const text = serializeCommentsQmd({ threads: [], suggestions });
    expect(deriveSuggestions(parsed(text))).toEqual(suggestions);
  });

  it("1.2d suggestion items state their kind, file and author in the file", () => {
    const text = serializeCommentsQmd({ threads: [], suggestions: [sugIns("s1", CREATED), sugDel("s2", CREATED)] });
    expect(text).toContain("suggestion=\"insert\"");
    expect(text).toContain("suggestion=\"delete\"");
    expect(text).toContain("old words");
    expect(text).toContain("file=\"main.tex\"");
  });

  it("1.2d threads and suggestions round-trip together and stay apart", () => {
    const threads = [thread("t1"), thread("t2")];
    const suggestions = [sugIns("s1", CREATED), sugDel("s2", "2026-10-21T08:00:00.000Z")];
    const doc = parsed(serializeCommentsQmd({ threads, suggestions }));
    expect(deriveCommentThreads(doc)).toEqual(threads);
    expect(deriveSuggestions(doc)).toEqual(suggestions);
  });

  it("1.2d writes suggestions after the threads, sorted by created then id", () => {
    const suggestions = [
      sugIns("s-c", "2026-10-22T08:00:00.000Z"),
      sugIns("s-b", "2026-10-20T08:00:00.000Z"),
      sugIns("s-a", "2026-10-20T08:00:00.000Z"),
    ];
    const text = serializeCommentsQmd({ threads: [thread("t1")], suggestions });
    const at = (id: string): number => text.indexOf(`{#${id} `);
    expect(at("t1")).toBeGreaterThanOrEqual(0);
    expect(at("t1")).toBeLessThan(at("s-a"));
    expect(at("s-a")).toBeLessThan(at("s-b"));
    expect(at("s-b")).toBeLessThan(at("s-c"));
  });

  it("1.2d a file with only threads is written with the same bytes", () => {
    const text = serializeCommentsQmd({ threads: [thread("t1")] });
    expect(serializeCommentsQmd(parsed(text))).toBe(text);
  });

  it("1.2d a parsed file with suggestions is written with the same bytes", () => {
    const text = serializeCommentsQmd({ threads: [thread("t1")], suggestions: [sugIns("s1", CREATED), sugDel("s2", "2026-10-21T08:00:00.000Z")] });
    expect(serializeCommentsQmd(parsed(text))).toBe(text);
  });
});

describe("addSuggestions and removeSuggestions", () => {
  const original = [
    "Notes the team keeps above the threads.",
    "",
    "::: {#t1 .labshelf-item anchor=\"quote:eyJxdW90ZSI6ImEiLCJwcmVmaXgiOiIiLCJzdWZmaXgiOiIifQ\" file=\"main.tex\" author=\"Ana\" created=\"2026-10-16T09:12:00.000Z\" x-extra=\"keep-me\"}",
    "Which one?",
    ":::",
    "",
  ].join("\n");

  it("1.2d addSuggestions adds the suggestions and leaves the threads", () => {
    const doc = parsed(original);
    const threadsBefore = deriveCommentThreads(doc);
    const next = addSuggestions(doc, [sugIns("s1", CREATED), sugDel("s2", CREATED)]);
    expect(sortedIds(deriveSuggestions(next))).toEqual(["s1", "s2"]);
    expect(deriveCommentThreads(next)).toEqual(threadsBefore);
  });

  it("1.2d addSuggestions keeps the suggestions already in the document", () => {
    const doc = addSuggestions(parsed(original), [sugIns("s1", CREATED)]);
    const next = addSuggestions(doc, [sugDel("s2", CREATED)]);
    expect(sortedIds(deriveSuggestions(next))).toEqual(["s1", "s2"]);
  });

  it("1.2d addSuggestions does not change the document it is given", () => {
    const doc = parsed(original);
    addSuggestions(doc, [sugIns("s1", CREATED)]);
    expect(deriveSuggestions(doc)).toEqual([]);
  });

  it("1.2d a written document keeps the thread item, its unknown attribute and the loose text", () => {
    const next = addSuggestions(parsed(original), [sugIns("s1", CREATED)]);
    const text = serializeCommentsQmd(next);
    expect(text).toContain("Notes the team keeps above the threads.");
    expect(text).toContain("x-extra=\"keep-me\"");
    expect(text).toContain(original.slice(original.indexOf("::: {#t1")));
    expect(sortedIds(deriveSuggestions(parsed(text)))).toEqual(["s1"]);
  });

  it("1.2d removeSuggestions removes the listed ids only", () => {
    const doc = addSuggestions(parsed(original), [sugIns("s1", CREATED), sugDel("s2", CREATED), sugIns("s3", CREATED)]);
    const next = removeSuggestions(doc, ["s1", "s3"]);
    expect(sortedIds(deriveSuggestions(next))).toEqual(["s2"]);
    expect(deriveCommentThreads(next)).toEqual(deriveCommentThreads(doc));
  });

  it("1.2d removing what was added gives the original bytes", () => {
    const doc = parsed(original);
    const next = removeSuggestions(addSuggestions(doc, [sugIns("s1", CREATED), sugDel("s2", CREATED)]), ["s1", "s2"]);
    expect(serializeCommentsQmd(next)).toBe(original);
  });

  it("1.2d removeSuggestions with an unknown id changes nothing", () => {
    const doc = addSuggestions(parsed(original), [sugIns("s1", CREATED)]);
    const next = removeSuggestions(doc, ["nope"]);
    expect(deriveSuggestions(next)).toEqual(deriveSuggestions(doc));
    expect(serializeCommentsQmd(next)).toBe(serializeCommentsQmd(doc));
  });

  it("1.2d removeSuggestions does not expand a group", () => {
    const doc = addSuggestions(parsed(original), [sugDel("s1", CREATED, { group: "g1" }), sugIns("s2", CREATED, { group: "g1" })]);
    const next = removeSuggestions(doc, ["s1"]);
    expect(sortedIds(deriveSuggestions(next))).toEqual(["s2"]);
  });

  it("1.2d removeSuggestions on a document without suggestions leaves it as it is", () => {
    const doc = { threads: [thread("t1")] };
    expect(deriveSuggestions(removeSuggestions(doc, ["s1"]))).toEqual([]);
    expect(deriveCommentThreads(removeSuggestions(doc, ["s1"]))).toEqual(doc.threads);
  });
});

describe("collab index", () => {
  it("1.2d exports the suggestion functions", () => {
    for (const name of ["readSuggestion", "deriveSuggestionAnchor", "findSuggestion", "resolveSuggestionText", "deriveSuggestions", "addSuggestions", "removeSuggestions"]) {
      expect(typeof (collab as Record<string, unknown>)[name]).toBe("function");
    }
  });
});
