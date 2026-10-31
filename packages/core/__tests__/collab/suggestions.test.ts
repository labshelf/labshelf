/**
 * Verifies suggestion records: validation, anchors, re-finding in changed text, the text of an accept or reject.
 * Verifies locating a shared project's suggestions in live texts and resolving them through the store.
 */
import * as Y from "yjs";
import { deriveLiveAnchor } from "../../src/collab/comments";
import { importCommentsFile } from "../../src/collab/commentsFile";
import { serializeCommentsQmd } from "../../src/collab/commentsQmd";
import { readShareIndexDocFiles, readShareIndexDocSuggestions } from "../../src/collab/shareIndexDoc";
import { readFileText } from "../../src/collab/sharedFiles";
import {
  addLiveSuggestion, createSharedProjectSuggestions, deriveSuggestionAnchor, findSuggestion, readLiveSuggestions, readSuggestion,
  resolveSuggestionText, type Suggestion,
} from "../../src/collab/suggestions";
import { CREATED, replicate, sortedIds, sugDel, sugIns, thread } from "./suggestionsFixtures";

const BASE = [
  "Introduction paragraph that sets the scene for the reader.",
  "We use a strong baseline and compare it against the new method on three datasets.",
  "The closing paragraph summarises what the reader should take away from this section.",
].join("\n");


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
    expect(anchor.prefix).toBe(TEXT.slice(Math.max(0, start - 32), start));
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
    expect(anchor.prefix).toBe(TEXT.slice(Math.max(0, at - 32), at));
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
