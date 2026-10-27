/**
 * Verifies parsing, editing and writing a project's .labshelf/comments.json without losing what it cannot read.
 * Verifies loading and editing comments.json through a file access: an invalid file is never written and every edit starts from a fresh read.
 * Verifies that a shared project's comments.json is written from the comments map and seeds it, losing nothing.
 * Verifies the comment lifecycle over a shared project's session: threads, placement in live texts, edits and change events.
 */
import {
  addThread,
  deriveCommentThreads,
  parseCommentsFile,
  addThreadReply,
  serializeCommentsFile,
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
} from "../../src/collab/index";
import * as Y from "yjs";

describe("comments.json", () => {
  const thread: CommentThread = {
    id: "t1", file: "main.tex", anchor: { quote: "baseline", prefix: "a strong ", suffix: " on" },
    comments: [{ id: "c1", author: "Ana", body: "Which one?", createdAt: "2026-10-16T09:12:00.000Z" }], resolved: false,
  };

  it("reads a missing threads array, invalid JSON and conflict markers as unreadable", () => {
    expect(parseCommentsFile("{}")).toBeUndefined();
    expect(parseCommentsFile("[]")).toBeUndefined();
    expect(parseCommentsFile('<<<<<<< ours\n{"threads": []}\n=======\n{"threads": []}\n>>>>>>> theirs\n')).toBeUndefined();
  });

  it("writes keys in contract order with two-space indent and a final newline", () => {
    const shuffled = { threads: [{ resolved: false, comments: [{ createdAt: thread.comments[0]!.createdAt, body: "Which one?", author: "Ana", id: "c1" }],
      anchor: { suffix: " on", prefix: "a strong ", quote: "baseline" }, file: "main.tex", id: "t1" }] };
    const text = serializeCommentsFile(shuffled);
    expect(text).toBe(`${JSON.stringify({ threads: [thread] }, null, 2)}\n`);
  });

  it("keeps invalid threads, invalid comments and unknown keys on rewrite but shows only valid ones", () => {
    const invalid = { id: "t2", file: "main.tex" };
    const raw = { version: 7, threads: [{ ...thread, colour: "red", comments: [...thread.comments, { id: "c2" }] }, invalid] };
    const doc = parseCommentsFile(JSON.stringify(raw))!;
    expect(deriveCommentThreads(doc)).toEqual([thread]);
    const next = parseCommentsFile(serializeCommentsFile(addThreadReply(doc, "t1", { id: "c3", author: "Bo", body: "Ours", createdAt: "2026-10-17T10:00:00.000Z" })))!;
    expect(next["version"]).toBe(7);
    expect(next.threads[1]).toEqual(invalid);
    expect(next.threads[0]).toMatchObject({ colour: "red", comments: [thread.comments[0], { id: "c2" }, { id: "c3" }] });
  });

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

  it("leaves an invalid file untouched and throws", async () => {
    const file = access("{ not json");
    await expect(updateCommentsDocument(file, (doc) => addThread(doc, thread("t1")))).rejects.toThrow(/left as it is/);
    expect(file.writes).toBe(0);
    expect(file.text).toBe("{ not json");
  });

  it("reads again before writing, so a change made elsewhere is kept", async () => {
    const file = access(undefined);
    await updateCommentsDocument(file, (doc) => addThread(doc, thread("t1")));
    const stale = await loadCommentsDocument(file);
    await updateCommentsDocument(file, (doc) => addThread(doc, thread("t2")));
    await updateCommentsDocument(file, (doc) => setThreadResolved(addThreadReply(doc, "t1", thread("x").comments[0]!), "t1", true));
    expect(stale?.threads).toHaveLength(1);
    const ids = (await loadCommentsDocument(file))?.threads.map((each) => (each as CommentThread).id);
    expect(ids).toEqual(["t1", "t2"]);
  });
});

describe("comments.json from the comments map", () => {
  const thread = (id: string, createdAt: string): CommentThread => ({
    id, file: "main.tex", anchor: { quote: "q", prefix: "a", suffix: "b" },
    comments: [{ id: `${id}-c`, author: "Ana", body: "x", createdAt }], resolved: false,
  });

  it("imports valid threads with unknown keys and writes them back with the file's other entries", () => {
    const file = JSON.stringify({ version: 2, threads: [{ ...thread("t2", "2026-10-16T10:00:00.000Z"), colour: "red" }, { id: "bad" }, thread("t1", "2026-10-16T09:00:00.000Z")] });
    const doc = new Y.Doc();
    expect(importCommentsFile(doc, file)).toBe(2);
    expect(readLiveThreads(doc).map((each) => each.id)).toEqual(["t1", "t2"]);
    const written = parseCommentsFile(renderCommentsFile(doc, file)!)!;
    expect(written["version"]).toBe(2);
    expect(written.threads).toEqual([thread("t1", "2026-10-16T09:00:00.000Z"), { ...thread("t2", "2026-10-16T10:00:00.000Z"), colour: "red" }, { id: "bad" }]);
  });

  it("writes a fresh file when there is none, and the same text on every member", () => {
    const a = new Y.Doc();
    importCommentsFile(a, JSON.stringify({ threads: [thread("t1", "2026-10-16T09:00:00.000Z")] }));
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(renderCommentsFile(b, undefined)).toBe(renderCommentsFile(a, undefined));
    expect(parseCommentsFile(renderCommentsFile(a, undefined)!)!.threads).toHaveLength(1);
  });

  it("never overwrites a conflict-marked file and does not import it", () => {
    const conflicted = '<<<<<<< ours\n{"threads": []}\n=======\n{"threads": []}\n>>>>>>> theirs\n';
    const doc = new Y.Doc();
    expect(importCommentsFile(doc, conflicted)).toBeUndefined();
    expect(renderCommentsFile(doc, conflicted)).toBeUndefined();
  });

  it("does not replace a thread the map already holds", () => {
    const doc = new Y.Doc();
    importCommentsFile(doc, JSON.stringify({ threads: [thread("t1", "2026-10-16T09:00:00.000Z")] }));
    expect(importCommentsFile(doc, JSON.stringify({ threads: [{ ...thread("t1", "2026-10-16T09:00:00.000Z"), resolved: true }] }))).toBe(0);
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
