/**
 * Verifies suggestion records: validation, anchors, re-finding in changed text, the text of an accept or reject.
 * Verifies that suggestion items round-trip through comments.qmd beside comment threads and that adding or removing suggestions changes nothing else.
 * Verifies the share index doc's suggestions map: add, read and remove, rendering into comments.qmd, seeding from it, and locating a shared suggestion in a live text.
 */
import * as Y from "yjs";
import { deriveLiveAnchor, type CommentThread } from "../../src/collab/comments";
import { parseCommentsQmd, serializeCommentsQmd } from "../../src/collab/commentsQmd";
import { addSuggestions, deriveSuggestions, deriveCommentThreads, removeSuggestions } from "../../src/collab/commentsFile";
import * as collab from "../../src/collab/index";
import { importCommentsFile, renderCommentsFile } from "../../src/collab/commentsFile";
import { readLiveThreads } from "../../src/collab/comments";
import { readShareIndexDocComments, readShareIndexDocFiles, readShareIndexDocSuggestions } from "../../src/collab/shareIndexDoc";
import { readFileText } from "../../src/collab/sharedFiles";
import {
  addLiveSuggestion, createSharedProjectSuggestions, deriveSuggestionAnchor, findSuggestion, readLiveSuggestions, readSuggestion,
  removeLiveSuggestions, resolveSuggestionText, type Suggestion,
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

const byId = (suggestions: readonly Suggestion[]): Suggestion[] => [...suggestions].sort((a, b) => a.id.localeCompare(b.id));

function replicate(from: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(from));
  return copy;
}

describe("the suggestions map", () => {
  it("1.3a the map is the index doc's suggestions map", () => {
    const doc = new Y.Doc();
    expect(readShareIndexDocSuggestions(doc)).toBe(doc.getMap("suggestions"));
  });

  it("1.3a an added suggestion is read back unchanged", () => {
    const doc = new Y.Doc();
    const suggestion = sugIns("s1", CREATED, { group: "g1" });
    expect(addLiveSuggestion(doc, suggestion)).toBe(true);
    expect(readLiveSuggestions(doc)).toEqual([suggestion]);
  });

  it("1.3a an empty map reads no suggestions", () => {
    expect(readLiveSuggestions(new Y.Doc())).toEqual([]);
  });

  it("1.3a holds one Y.Map per suggestion keyed by id, with only plain values", () => {
    const doc = new Y.Doc();
    addLiveSuggestion(doc, sugDel("s2", CREATED, { group: "g1" }));
    const entry = readShareIndexDocSuggestions(doc).get("s2");
    expect(entry).toBeInstanceOf(Y.Map);
    for (const value of (entry as Y.Map<unknown>).values()) {
      expect(value instanceof Y.AbstractType).toBe(false);
    }
    expect((entry as Y.Map<unknown>).get("kind")).toBe("delete");
    expect((entry as Y.Map<unknown>).get("text")).toBe("old words");
  });

  it("1.3a keeps the relative positions of an anchor", () => {
    const doc = new Y.Doc();
    const suggestion = sugIns("s1", CREATED, { anchor: { quote: "brand new words", prefix: "so we add ", suffix: " here", start: "AQID", end: "BAUG" } });
    addLiveSuggestion(doc, suggestion);
    expect(readLiveSuggestions(doc)).toEqual([suggestion]);
  });

  it("1.3a refuses a suggestion whose id the map holds and keeps the first", () => {
    const doc = new Y.Doc();
    addLiveSuggestion(doc, sugIns("s1", CREATED));
    expect(addLiveSuggestion(doc, sugIns("s1", CREATED, { author: "Other" }))).toBe(false);
    expect(readLiveSuggestions(doc)).toEqual([sugIns("s1", CREATED)]);
  });

  it("1.3a refuses a duplicate even when its kind differs", () => {
    const doc = new Y.Doc();
    addLiveSuggestion(doc, sugIns("s1", CREATED));
    expect(addLiveSuggestion(doc, sugDel("s1", CREATED))).toBe(false);
    expect(readLiveSuggestions(doc)).toHaveLength(1);
    expect(readLiveSuggestions(doc)[0]!.kind).toBe("insert");
  });

  it("1.3a keeps the unknown keys of a record it adds", () => {
    const doc = new Y.Doc();
    addLiveSuggestion(doc, { ...sugIns("s1", CREATED), "x-extra": "keep-me", "x-count": 3 });
    const stored = (readShareIndexDocSuggestions(doc).get("s1") as Y.Map<unknown>).toJSON();
    expect(stored["x-extra"]).toBe("keep-me");
    expect(stored["x-count"]).toBe(3);
  });

  it("1.3a keeps the unknown keys after a read and when the map travels to a peer", () => {
    const doc = new Y.Doc();
    addLiveSuggestion(doc, { ...sugIns("s1", CREATED), "x-extra": "keep-me" });
    readLiveSuggestions(doc);
    const peer = replicate(doc);
    expect((readShareIndexDocSuggestions(peer).get("s1") as Y.Map<unknown>).get("x-extra")).toBe("keep-me");
    expect(readLiveSuggestions(peer)).toHaveLength(1);
  });

  it("1.3a skips entries that are not valid suggestions", () => {
    const doc = new Y.Doc();
    addLiveSuggestion(doc, sugIns("s1", CREATED));
    const map = readShareIndexDocSuggestions(doc);
    map.set("plain", { id: "plain", file: "main.tex" });
    const broken = new Y.Map<unknown>();
    broken.set("id", "broken");
    broken.set("kind", "insert");
    map.set("broken", broken);
    expect(readLiveSuggestions(doc).map((each) => each.id)).toEqual(["s1"]);
  });

  it("1.3a removes the listed ids and returns how many it removed", () => {
    const doc = new Y.Doc();
    for (const each of [sugIns("s1", CREATED), sugDel("s2", CREATED), sugIns("s3", CREATED)]) { addLiveSuggestion(doc, each); }
    expect(removeLiveSuggestions(doc, ["s1", "s3"])).toBe(2);
    expect(readLiveSuggestions(doc).map((each) => each.id)).toEqual(["s2"]);
  });

  it("1.3a counts only the ids the map held", () => {
    const doc = new Y.Doc();
    addLiveSuggestion(doc, sugIns("s1", CREATED));
    expect(removeLiveSuggestions(doc, ["s1", "nope", "nada"])).toBe(1);
    expect(removeLiveSuggestions(doc, ["s1"])).toBe(0);
    expect(removeLiveSuggestions(doc, [])).toBe(0);
    expect(readLiveSuggestions(doc)).toEqual([]);
  });

  it("1.3a removes every listed id in one transaction", () => {
    const doc = new Y.Doc();
    for (const each of [sugIns("s1", CREATED), sugDel("s2", CREATED), sugIns("s3", CREATED)]) { addLiveSuggestion(doc, each); }
    const updates = jest.fn();
    doc.on("update", updates);
    removeLiveSuggestions(doc, ["s1", "s2", "s3"]);
    expect(updates).toHaveBeenCalledTimes(1);
  });

  it("1.3a removing a suggestion does not expand its group", () => {
    const doc = new Y.Doc();
    addLiveSuggestion(doc, sugDel("s1", CREATED, { group: "g1" }));
    addLiveSuggestion(doc, sugIns("s2", CREATED, { group: "g1" }));
    removeLiveSuggestions(doc, ["s1"]);
    expect(readLiveSuggestions(doc).map((each) => each.id)).toEqual(["s2"]);
  });

  it("1.3a leaves the comments map and its threads alone", () => {
    const doc = new Y.Doc();
    importCommentsFile(doc, serializeCommentsQmd({ threads: [thread("t1")] }));
    addLiveSuggestion(doc, sugIns("s1", CREATED));
    removeLiveSuggestions(doc, ["s1"]);
    expect(readLiveThreads(doc).map((each) => each.id)).toEqual(["t1"]);
    expect(readShareIndexDocComments(doc).has("s1")).toBe(false);
  });

  it("1.3a members see the same suggestions in the same order", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    addLiveSuggestion(a, sugIns("s-b", "2026-10-21T08:00:00.000Z"));
    addLiveSuggestion(b, sugDel("s-a", "2026-10-20T08:00:00.000Z"));
    addLiveSuggestion(b, sugIns("s-c", "2026-10-20T08:00:00.000Z"));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(readLiveSuggestions(a)).toEqual(readLiveSuggestions(b));
    expect(sortedIds(readLiveSuggestions(a))).toEqual(["s-a", "s-b", "s-c"]);
  });

  it("A1 records round-trip through the index doc map", () => {
    const doc = new Y.Doc();
    const suggestions = [
      sugDel("s1", "2026-10-20T08:00:00.000Z", { group: "g7", text: "first line\n\nsecond line" }),
      sugIns("s2", "2026-10-20T09:00:00.000Z", { group: "g7", anchor: { quote: "brand new words", prefix: "so we add ", suffix: " here", start: "AQID", end: "BAUG" } }),
      sugIns("s3", "2026-10-21T09:00:00.000Z"),
    ];
    for (const each of suggestions) { expect(addLiveSuggestion(doc, each)).toBe(true); }
    expect(byId(readLiveSuggestions(doc))).toEqual(byId(suggestions));
    expect(byId(readLiveSuggestions(replicate(doc)))).toEqual(byId(suggestions));
  });
});

describe("suggestions rendered into and seeded from comments.qmd", () => {
  const suggestions = [sugIns("s1", "2026-10-20T08:00:00.000Z"), sugDel("s2", "2026-10-21T08:00:00.000Z", { group: "g1" })];

  function docWith(list: readonly Suggestion[]): Y.Doc {
    const doc = new Y.Doc();
    for (const each of list) { addLiveSuggestion(doc, each); }
    return doc;
  }

  it("1.3b renders the map's suggestions into a fresh file", () => {
    const text = renderCommentsFile(docWith(suggestions), undefined);
    expect(text).toBeDefined();
    expect(deriveSuggestions(parsed(text!))).toEqual(suggestions);
  });

  it("1.3b renders threads and suggestions together", () => {
    const doc = docWith(suggestions);
    importCommentsFile(doc, serializeCommentsQmd({ threads: [thread("t1")] }));
    const file = parsed(renderCommentsFile(doc, undefined)!);
    expect(deriveCommentThreads(file).map((each) => each.id)).toEqual(["t1"]);
    expect(deriveSuggestions(file)).toEqual(suggestions);
  });

  it("1.3b keeps the loose text of the existing file", () => {
    const existing = "Notes the team keeps above the threads.\n";
    const text = renderCommentsFile(docWith(suggestions), existing);
    expect(text).toContain("Notes the team keeps above the threads.");
    expect(deriveSuggestions(parsed(text!))).toEqual(suggestions);
  });

  it("1.3b drops the suggestions of the existing file that the map no longer holds", () => {
    const existing = serializeCommentsQmd({ threads: [], suggestions });
    const doc = docWith(suggestions);
    removeLiveSuggestions(doc, ["s1"]);
    expect(sortedIds(deriveSuggestions(parsed(renderCommentsFile(doc, existing)!)))).toEqual(["s2"]);
  });

  it("1.3b renders no suggestion items for an empty map", () => {
    const existing = serializeCommentsQmd({ threads: [], suggestions });
    const text = renderCommentsFile(new Y.Doc(), existing)!;
    expect(deriveSuggestions(parsed(text))).toEqual([]);
    expect(text).not.toContain("suggestion=");
  });

  it("1.3b writes the same text on every member", () => {
    const a = docWith(suggestions);
    const b = replicate(a);
    expect(renderCommentsFile(b, undefined)).toBe(renderCommentsFile(a, undefined));
  });

  it("1.3b never overwrites a conflict-marked file", () => {
    const conflicted = `<<<<<<< ours\n${serializeCommentsQmd({ threads: [], suggestions })}=======\n>>>>>>> theirs\n`;
    expect(renderCommentsFile(docWith(suggestions), conflicted)).toBeUndefined();
  });

  it("1.3b seeds the map with the suggestions of a file", () => {
    const doc = new Y.Doc();
    importCommentsFile(doc, serializeCommentsQmd({ threads: [], suggestions }));
    expect(byId(readLiveSuggestions(doc))).toEqual(byId(suggestions));
  });

  it("1.3b its return value stays the count of threads added", () => {
    const doc = new Y.Doc();
    expect(importCommentsFile(doc, serializeCommentsQmd({ threads: [thread("t1"), thread("t2")], suggestions }))).toBe(2);
    expect(importCommentsFile(new Y.Doc(), serializeCommentsQmd({ threads: [], suggestions }))).toBe(0);
  });

  it("1.3b seeds only the suggestions the map lacks, by id", () => {
    const doc = docWith([sugIns("s1", "2026-10-20T08:00:00.000Z", { author: "Mapped" })]);
    importCommentsFile(doc, serializeCommentsQmd({ threads: [], suggestions }));
    const read = byId(readLiveSuggestions(doc));
    expect(read.map((each) => each.id)).toEqual(["s1", "s2"]);
    expect(read[0]!.author).toBe("Mapped");
  });

  it("1.3b importing the same file twice adds nothing the second time", () => {
    const doc = new Y.Doc();
    const text = serializeCommentsQmd({ threads: [thread("t1")], suggestions });
    importCommentsFile(doc, text);
    expect(importCommentsFile(doc, text)).toBe(0);
    expect(readLiveSuggestions(doc)).toHaveLength(2);
  });

  it("1.3b does not import a conflict-marked file", () => {
    const doc = new Y.Doc();
    const conflicted = `<<<<<<< ours\n${serializeCommentsQmd({ threads: [], suggestions })}=======\n>>>>>>> theirs\n`;
    expect(importCommentsFile(doc, conflicted)).toBeUndefined();
    expect(readLiveSuggestions(doc)).toEqual([]);
  });

  it("1.3b render then import moves suggestions from map to file to map unchanged", () => {
    const source = docWith(suggestions);
    const text = renderCommentsFile(source, undefined)!;
    const target = new Y.Doc();
    importCommentsFile(target, text);
    expect(readLiveSuggestions(target)).toEqual(readLiveSuggestions(source));
  });

  it("1.3b import then render gives the file's bytes back", () => {
    const text = serializeCommentsQmd({ threads: [thread("t1")], suggestions });
    const doc = new Y.Doc();
    importCommentsFile(doc, text);
    expect(renderCommentsFile(doc, text)).toBe(text);
  });
});

describe("shared project suggestions", () => {
  function session() {
    const index = new Y.Doc();
    const docs = new Map<string, Y.Doc>();
    const openDoc = (path: string): Y.Doc => { let doc = docs.get(path); if (!doc) { doc = new Y.Doc(); docs.set(path, doc); } return doc; };
    return { index, openDoc, docs };
  }

  function sharedFile(shared: ReturnType<typeof session>, path: string, text: string): Y.Text {
    readShareIndexDocFiles(shared.index).set(path, { kind: "text" });
    const yText = readFileText(shared.openDoc(path));
    yText.insert(0, text);
    return yText;
  }

  /** Applies an edit made by a peer on its own copy of the file doc, then merges it back. */
  function peerEdit(doc: Y.Doc, edit: (yText: Y.Text) => void): void {
    const peer = replicate(doc);
    edit(readFileText(peer));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
  }

  const TEXT = "We use a strong baseline and compare it against the new method.";

  it("1.3c anchors an insert to the live text with the quote and relative positions", () => {
    const shared = session();
    sharedFile(shared, "main.tex", TEXT);
    const suggestions = createSharedProjectSuggestions(shared);
    const start = TEXT.indexOf("a strong baseline");
    const anchor = suggestions.anchor("main.tex", "insert", { start, end: start + 17 });
    expect(anchor.quote).toBe("a strong baseline");
    expect(anchor.prefix).toBe(TEXT.slice(start - 32, start));
    expect(anchor.suffix).toBe(TEXT.slice(start + 17, start + 17 + 32));
    expect(typeof anchor.start).toBe("string");
    expect(typeof anchor.end).toBe("string");
  });

  it("1.3c anchors a delete with an empty quote and relative positions", () => {
    const shared = session();
    sharedFile(shared, "main.tex", TEXT);
    const suggestions = createSharedProjectSuggestions(shared);
    const at = TEXT.indexOf("compare");
    const anchor = suggestions.anchor("main.tex", "delete", { start: at, end: at });
    expect(anchor.quote).toBe("");
    expect(anchor.prefix).toBe(TEXT.slice(at - 32, at));
    expect(anchor.suffix).toBe(TEXT.slice(at, at + 32));
    expect(typeof anchor.start).toBe("string");
    expect(typeof anchor.end).toBe("string");
  });

  it("1.3c refuses to anchor in a file the share does not list as text", () => {
    const shared = session();
    const suggestions = createSharedProjectSuggestions(shared);
    expect(() => suggestions.anchor("gone.tex", "insert", { start: 0, end: 1 })).toThrow();
    expect(shared.docs.has("gone.tex")).toBe(false);
  });

  it("1.3c a shared insert is located after a concurrent edit before it", () => {
    const shared = session();
    sharedFile(shared, "main.tex", TEXT);
    const suggestions = createSharedProjectSuggestions(shared);
    const start = TEXT.indexOf("a strong baseline");
    const anchor = suggestions.anchor("main.tex", "insert", { start, end: start + 17 });
    suggestions.add([{ id: "s1", file: "main.tex", kind: "insert", anchor, author: "Ana", created: CREATED }]);
    peerEdit(shared.openDoc("main.tex"), (yText) => { yText.insert(0, "Peer wrote this. "); });
    const [stored] = suggestions.suggestions();
    expect(stored?.id).toBe("s1");
    const shift = "Peer wrote this. ".length;
    expect(suggestions.locate(stored!)).toEqual({ start: start + shift, end: start + shift + 17 });
  });

  it("1.3c a shared insert is located after a local edit before it", () => {
    const shared = session();
    const yText = sharedFile(shared, "main.tex", TEXT);
    const suggestions = createSharedProjectSuggestions(shared);
    const start = TEXT.indexOf("a strong baseline");
    const anchor = suggestions.anchor("main.tex", "insert", { start, end: start + 17 });
    suggestions.add([{ id: "s1", file: "main.tex", kind: "insert", anchor, author: "Ana", created: CREATED }]);
    yText.insert(0, "Oh. ");
    expect(suggestions.locate(suggestions.suggestions()[0]!)).toEqual({ start: start + 4, end: start + 4 + 17 });
  });

  it("1.3c a shared delete is located as an empty range after a concurrent edit before it", () => {
    const shared = session();
    sharedFile(shared, "main.tex", TEXT);
    const suggestions = createSharedProjectSuggestions(shared);
    const at = TEXT.indexOf("compare");
    const anchor = suggestions.anchor("main.tex", "delete", { start: at, end: at });
    suggestions.add([{ id: "s2", file: "main.tex", kind: "delete", anchor, text: "and ", author: "Bo", created: CREATED }]);
    peerEdit(shared.openDoc("main.tex"), (yText) => { yText.insert(0, "Peer wrote this. "); });
    const shift = "Peer wrote this. ".length;
    expect(suggestions.locate(suggestions.suggestions()[0]!)).toEqual({ start: at + shift, end: at + shift });
  });

  it("1.3c a delete's live anchor locates at the same index in the unchanged text", () => {
    const shared = session();
    sharedFile(shared, "main.tex", TEXT);
    const suggestions = createSharedProjectSuggestions(shared);
    const at = TEXT.indexOf("compare");
    const anchor = suggestions.anchor("main.tex", "delete", { start: at, end: at });
    const suggestion: Suggestion = { id: "s2", file: "main.tex", kind: "delete", anchor, text: "and ", author: "Bo", created: CREATED };
    expect(suggestions.locate(suggestion)).toEqual({ start: at, end: at });
  });

  it("1.3c detaches a suggestion whose file the share does not list as text, and opens no doc for it", () => {
    const shared = session();
    const suggestions = createSharedProjectSuggestions(shared);
    const suggestion = sugIns("s1", CREATED, { file: "gone.tex" });
    expect(suggestions.locate(suggestion)).toBe("detached");
    expect(shared.docs.has("gone.tex")).toBe(false);
  });

  it("1.3a adds several suggestions, reads them and removes them", () => {
    const shared = session();
    const suggestions = createSharedProjectSuggestions(shared);
    suggestions.add([sugDel("s1", CREATED, { group: "g1" }), sugIns("s2", CREATED, { group: "g1" })]);
    expect(sortedIds(suggestions.suggestions())).toEqual(["s1", "s2"]);
    suggestions.remove(["s1", "s2"]);
    expect(suggestions.suggestions()).toEqual([]);
  });

  it("1.3a writes into the index doc's suggestions map", () => {
    const shared = session();
    const suggestions = createSharedProjectSuggestions(shared);
    suggestions.add([sugIns("s1", CREATED)]);
    expect(readLiveSuggestions(shared.index)).toEqual([sugIns("s1", CREATED)]);
    expect(readShareIndexDocSuggestions(shared.index).has("s1")).toBe(true);
  });

  it("1.3a removing an unknown id changes nothing", () => {
    const shared = session();
    const suggestions = createSharedProjectSuggestions(shared);
    suggestions.add([sugIns("s1", CREATED)]);
    suggestions.remove(["nope"]);
    expect(sortedIds(suggestions.suggestions())).toEqual(["s1"]);
  });

  it("1.3a reports every change here or by a peer until the listener is removed", () => {
    const shared = session();
    const suggestions = createSharedProjectSuggestions(shared);
    const changes = jest.fn();
    const stop = suggestions.onChange(changes);
    suggestions.add([sugIns("s1", CREATED)]);
    expect(changes).toHaveBeenCalledTimes(1);
    suggestions.remove(["s1"]);
    expect(changes).toHaveBeenCalledTimes(2);
    const peer = new Y.Doc();
    addLiveSuggestion(peer, sugIns("s9", CREATED));
    Y.applyUpdate(shared.index, Y.encodeStateAsUpdate(peer));
    expect(changes).toHaveBeenCalledTimes(3);
    expect(sortedIds(suggestions.suggestions())).toEqual(["s9"]);
    stop();
    suggestions.remove(["s9"]);
    expect(changes).toHaveBeenCalledTimes(3);
  });

  it("1.3a a comment change does not report a suggestions change", () => {
    const shared = session();
    const suggestions = createSharedProjectSuggestions(shared);
    const changes = jest.fn();
    suggestions.onChange(changes);
    importCommentsFile(shared.index, serializeCommentsQmd({ threads: [thread("t1")] }));
    expect(changes).not.toHaveBeenCalled();
  });
});
