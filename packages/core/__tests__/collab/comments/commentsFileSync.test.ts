/** Verifies that a shared project's comments.json is written from the comments map and seeds it, losing nothing. */
import * as Y from "yjs";
import {
  importCommentsFile, readLiveThreads, parseCommentsFile, renderCommentsFile, type CommentThread,
} from "../../../src/collab/comments/index";

const thread = (id: string, createdAt: string): CommentThread => ({
  id, file: "main.tex", anchor: { quote: "q", prefix: "a", suffix: "b" },
  comments: [{ id: `${id}-c`, author: "Ana", body: "x", createdAt }], resolved: false,
});

describe("comments.json from the comments map", () => {
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
