/** Verifies the comment threads in a share's index doc: edits from two members at once all survive a sync. */
import * as Y from "yjs";
import {
  addLiveThread, liveThreads, replyToLiveThread, setLiveThreadResolved, type CommentThread,
} from "../../../src/collab/comments/index";

const comment = (id: string, createdAt: string) => ({ id, author: "Ana", body: `body ${id}`, createdAt });
const thread = (id: string, createdAt: string): CommentThread => ({
  id, file: "main.tex", anchor: { quote: "q", prefix: "", suffix: "" }, comments: [comment(`${id}-c`, createdAt)], resolved: false,
});

function sync(a: Y.Doc, b: Y.Doc): void {
  const toB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const toA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, toB);
  Y.applyUpdate(a, toA);
}

describe("live comments", () => {
  it("keeps threads and replies two members add concurrently", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    addLiveThread(a, thread("t1", "2026-10-16T09:00:00.000Z"));
    sync(a, b);
    addLiveThread(a, thread("t2", "2026-10-16T10:00:00.000Z"));
    addLiveThread(b, thread("t3", "2026-10-16T11:00:00.000Z"));
    expect(replyToLiveThread(a, "t1", comment("ra", "2026-10-16T12:00:00.000Z"))).toBe(true);
    expect(replyToLiveThread(b, "t1", comment("rb", "2026-10-16T12:00:01.000Z"))).toBe(true);
    sync(a, b);
    for (const doc of [a, b]) {
      const threads = liveThreads(doc);
      expect(threads.map((each) => each.id)).toEqual(["t1", "t2", "t3"]);
      expect(threads[0]!.comments.map((each) => each.id).sort()).toEqual(["ra", "rb", "t1-c"]);
    }
    expect(liveThreads(a)).toEqual(liveThreads(b));
  });

  it("resolves and reopens, and reports a missing thread", () => {
    const doc = new Y.Doc();
    addLiveThread(doc, thread("t1", "2026-10-16T09:00:00.000Z"));
    expect(setLiveThreadResolved(doc, "t1", true)).toBe(true);
    expect(liveThreads(doc)[0]!.resolved).toBe(true);
    setLiveThreadResolved(doc, "t1", false);
    expect(liveThreads(doc)[0]!.resolved).toBe(false);
    expect(replyToLiveThread(doc, "nope", comment("x", "2026-10-16T09:00:00.000Z"))).toBe(false);
  });
});
