/**
 * Verifies editing a project's comment threads.
 * Verifies loading and editing comments.qmd through a file access: an unreadable file is never written and every edit starts from a fresh read.
 * Verifies that a shared project's comments.qmd is written from the comments map and seeds it, losing nothing.
 * Verifies that suggestion items round-trip through comments.qmd beside comment threads, that adding or removing suggestions changes nothing else, and that a shared project renders and seeds them.
 * Verifies the comment lifecycle over a shared project's session: threads, placement in live texts, edits and change events.
 */
import {
  addThread,
  deriveCommentThreads,
  addThreadReply,
  setThreadResolved,
  type CommentThread,
  updateCommentsDocument,
  loadCommentsDocument,
  type CommentsFileAccess,
  importCommentsFile,
  readLiveThreads,
  renderCommentsFile,
  readFileText,
  readShareIndexDocFiles,
  createSharedProjectComments,
  parseCommentsQmd,
  serializeCommentsQmd,
} from "../../src/collab/index";
import * as Y from "yjs";
import { addSuggestions, deriveSuggestions, removeSuggestions } from "../../src/collab/commentsFile";
import * as collab from "../../src/collab/index";
import { addLiveSuggestion, readLiveSuggestions, removeLiveSuggestions, type Suggestion } from "../../src/collab/suggestions";
import { CREATED, byId, parsed, replicate, sortedIds, sugDel, sugIns, thread } from "./suggestionsFixtures";

describe("comment threads", () => {
  const thread: CommentThread = {
    id: "t1", file: "main.tex", anchor: { quote: "baseline", prefix: "a strong ", suffix: " on" },
    comments: [{ id: "c1", author: "Ana", body: "Which one?", createdAt: "2026-10-16T09:12:00.000Z" }], resolved: false,
  };

  it("adds, resolves and reopens threads", () => {
    const added = addThread({ threads: [] }, thread);
    expect(deriveCommentThreads(setThreadResolved(added, "t1", true))[0]!.resolved).toBe(true);
    expect(deriveCommentThreads(setThreadResolved(setThreadResolved(added, "t1", true), "t1", false))[0]!.resolved).toBe(false);
  });
});

function access(initial: string | undefined): CommentsFileAccess & { text: string | undefined; writes: number } {
  const state = {
    text: initial, writes: 0,
    read: async () => state.text,
    write: async (next: string) => { state.text = next; state.writes += 1; },
  };
  return state;
}

describe("comments file store", () => {
  const thread = (id: string): CommentThread => ({
    id, file: "main.tex", anchor: { quote: "baseline", prefix: "a ", suffix: " on" },
    comments: [{ id: `${id}-c`, author: "Ana", body: "Which one?", createdAt: "2026-10-16T09:12:00.000Z" }], resolved: false,
  });

  it("loads a missing file as no threads and an invalid one as undefined", async () => {
    expect(await loadCommentsDocument(access(undefined))).toEqual({ threads: [] });
    expect(await loadCommentsDocument(access("<<<<<<< ours\n"))).toBeUndefined();
  });

  it("creates the file on the first edit", async () => {
    const file = access(undefined);
    await updateCommentsDocument(file, (doc) => addThread(doc, thread("t1")));
    expect((await loadCommentsDocument(file))?.threads).toHaveLength(1);
  });

  it("leaves a conflict-marked file untouched and throws", async () => {
    const conflicted = "<<<<<<< ours\nx\n=======\ny\n>>>>>>> theirs\n";
    const file = access(conflicted);
    await expect(updateCommentsDocument(file, (doc) => addThread(doc, thread("t1")))).rejects.toThrow(/left as it is/);
    expect(file.writes).toBe(0);
    expect(file.text).toBe(conflicted);
  });

  it("reads again before writing, so a change made elsewhere is kept", async () => {
    const file = access(undefined);
    await updateCommentsDocument(file, (doc) => addThread(doc, thread("t1")));
    const stale = await loadCommentsDocument(file);
    await updateCommentsDocument(file, (doc) => addThread(doc, thread("t2")));
    await updateCommentsDocument(file, (doc) => setThreadResolved(addThreadReply(doc, "t1", thread("x").comments[0]!), "t1", true));
    expect(stale?.threads).toHaveLength(1);
    const ids = (await loadCommentsDocument(file))?.threads.map((each) => each.id);
    expect(ids).toEqual(["t1", "t2"]);
  });
});

describe("comments.qmd from the comments map", () => {
  const thread = (id: string, createdAt: string): CommentThread => ({
    id, file: "main.tex", anchor: { quote: "q", prefix: "a", suffix: "b" },
    comments: [{ id: `${id}-c`, author: "Ana", body: "x", createdAt }], resolved: false,
  });
  const qmd = (...threads: CommentThread[]) => serializeCommentsQmd({ threads });

  it("imports valid threads and writes them back with the file's loose text and other items", () => {
    const other = "::: {#keep .labshelf-item}\nnot a comment\n:::\n";
    const file = `---\ntitle: Comments\n---\n\n${qmd(thread("t2", "2026-10-16T10:00:00.000Z"))}\n${other}\n${qmd(thread("t1", "2026-10-16T09:00:00.000Z"))}`;
    const doc = new Y.Doc();
    expect(importCommentsFile(doc, file)).toBe(2);
    expect(readLiveThreads(doc).map((each) => each.id)).toEqual(["t1", "t2"]);
    const written = renderCommentsFile(doc, file)!;
    expect(written.startsWith("---\ntitle: Comments\n---\n")).toBe(true);
    expect(written).toContain(other);
    expect(parseCommentsQmd(written)!.threads).toEqual([thread("t1", "2026-10-16T09:00:00.000Z"), thread("t2", "2026-10-16T10:00:00.000Z")]);
  });

  it("writes a fresh file when there is none, and the same text on every member", () => {
    const a = new Y.Doc();
    importCommentsFile(a, qmd(thread("t1", "2026-10-16T09:00:00.000Z")));
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(renderCommentsFile(b, undefined)).toBe(renderCommentsFile(a, undefined));
    expect(parseCommentsQmd(renderCommentsFile(a, undefined)!)!.threads).toHaveLength(1);
  });

  it("never overwrites a conflict-marked file and does not import it", () => {
    const conflicted = `<<<<<<< ours\n${qmd(thread("t1", "2026-10-16T09:00:00.000Z"))}=======\n>>>>>>> theirs\n`;
    const doc = new Y.Doc();
    expect(importCommentsFile(doc, conflicted)).toBeUndefined();
    expect(renderCommentsFile(doc, conflicted)).toBeUndefined();
  });

  it("does not replace a thread the map already holds", () => {
    const doc = new Y.Doc();
    importCommentsFile(doc, qmd(thread("t1", "2026-10-16T09:00:00.000Z")));
    expect(importCommentsFile(doc, qmd({ ...thread("t1", "2026-10-16T09:00:00.000Z"), resolved: true }))).toBe(0);
    expect(readLiveThreads(doc)[0]!.resolved).toBe(false);
  });
});

function session() {
  const index = new Y.Doc();
  const docs = new Map<string, Y.Doc>();
  const openDoc = (path: string): Y.Doc => { let doc = docs.get(path); if (!doc) { doc = new Y.Doc(); docs.set(path, doc); } return doc; };
  return { index, openDoc, docs };
}

const comment = (id: string) => ({ id, author: "Ana", body: `body ${id}`, createdAt: "2026-10-20T09:00:00.000Z" });

function sharedFile(shared: ReturnType<typeof session>, path: string, text: string): Y.Text {
  readShareIndexDocFiles(shared.index).set(path, { kind: "text" });
  const yText = readFileText(shared.openDoc(path));
  yText.insert(0, text);
  return yText;
}

describe("shared project comments", () => {
  it("anchors a thread to the live text so it follows edits made before it", () => {
    const shared = session();
    const yText = sharedFile(shared, "main.tex", "Hello brave world");
    const comments = createSharedProjectComments(shared);
    const thread: CommentThread = { id: "t1", file: "main.tex", anchor: comments.anchor("main.tex", { start: 6, end: 11 }), comments: [comment("c1")], resolved: false };
    comments.add(thread);
    yText.insert(0, "Oh. ");
    const [stored] = comments.threads();
    expect(stored?.id).toBe("t1");
    expect(comments.locate(stored!)).toEqual({ start: 10, end: 15 });
  });

  it("detaches a thread whose file the share does not list as text, and reads no text for it", () => {
    const shared = session();
    const comments = createSharedProjectComments(shared);
    const thread: CommentThread = { id: "t1", file: "gone.tex", anchor: { quote: "x", prefix: "", suffix: "" }, comments: [comment("c1")], resolved: false };
    comments.add(thread);
    expect(comments.textOf("gone.tex")).toBeUndefined();
    expect(comments.locate(thread)).toBe("detached");
    expect(shared.docs.has("gone.tex")).toBe(false);
  });

  it("replies, resolves and reports every change, and refuses a duplicate or missing thread", () => {
    const shared = session();
    sharedFile(shared, "main.tex", "text");
    const comments = createSharedProjectComments(shared);
    const changes = jest.fn();
    const stop = comments.onChange(changes);
    const thread: CommentThread = { id: "t1", file: "main.tex", anchor: comments.anchor("main.tex", { start: 0, end: 4 }), comments: [comment("c1")], resolved: false };
    comments.add(thread);
    comments.reply("t1", comment("c2"));
    comments.setResolved("t1", true);
    expect(comments.threads()[0]).toMatchObject({ resolved: true, comments: [{ id: "c1" }, { id: "c2" }] });
    expect(changes).toHaveBeenCalledTimes(3);
    expect(() => comments.add(thread)).toThrow(/t1/);
    expect(() => comments.reply("t9", comment("c3"))).toThrow(/t9/);
    expect(() => comments.setResolved("t9", false)).toThrow(/t9/);
    stop();
    comments.setResolved("t1", false);
    expect(changes).toHaveBeenCalledTimes(3);
  });
});

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
