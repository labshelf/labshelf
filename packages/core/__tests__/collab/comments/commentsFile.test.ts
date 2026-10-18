/** Verifies parsing, editing and writing a project's .labshelf/comments.json without losing what it cannot read. */
import {
  addThread, commentThreads, parseCommentsFile, replyToThread, serializeCommentsFile, setThreadResolved, type CommentThread,
} from "../../../src/collab/comments/index";

const thread: CommentThread = {
  id: "t1", file: "main.tex", anchor: { quote: "baseline", prefix: "a strong ", suffix: " on" },
  comments: [{ id: "c1", author: "Ana", body: "Which one?", createdAt: "2026-10-16T09:12:00.000Z" }], resolved: false,
};

describe("comments.json", () => {
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
    expect(commentThreads(doc)).toEqual([thread]);
    const next = parseCommentsFile(serializeCommentsFile(replyToThread(doc, "t1", { id: "c3", author: "Bo", body: "Ours", createdAt: "2026-10-17T10:00:00.000Z" })))!;
    expect(next["version"]).toBe(7);
    expect(next.threads[1]).toEqual(invalid);
    expect(next.threads[0]).toMatchObject({ colour: "red", comments: [thread.comments[0], { id: "c2" }, { id: "c3" }] });
  });

  it("adds, resolves and reopens threads", () => {
    const added = addThread({ threads: [] }, thread);
    expect(commentThreads(setThreadResolved(added, "t1", true))[0]!.resolved).toBe(true);
    expect(commentThreads(setThreadResolved(setThreadResolved(added, "t1", true), "t1", false))[0]!.resolved).toBe(false);
  });
});
