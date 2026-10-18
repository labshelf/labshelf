/** Verifies loading and editing comments.json through a file access: an invalid file is never written and every edit starts from a fresh read. */
import {
  addThread, editCommentsDocument, loadCommentsDocument, replyToThread, setThreadResolved,
  type CommentsFileAccess, type CommentThread,
} from "../../../src/collab/comments/index";

const thread = (id: string): CommentThread => ({
  id, file: "main.tex", anchor: { quote: "baseline", prefix: "a ", suffix: " on" },
  comments: [{ id: `${id}-c`, author: "Ana", body: "Which one?", createdAt: "2026-10-16T09:12:00.000Z" }], resolved: false,
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
  it("loads a missing file as no threads and an invalid one as undefined", async () => {
    expect(await loadCommentsDocument(access(undefined))).toEqual({ threads: [] });
    expect(await loadCommentsDocument(access("<<<<<<< ours\n"))).toBeUndefined();
  });

  it("creates the file on the first edit", async () => {
    const file = access(undefined);
    await editCommentsDocument(file, (doc) => addThread(doc, thread("t1")));
    expect((await loadCommentsDocument(file))?.threads).toHaveLength(1);
  });

  it("leaves an invalid file untouched and throws", async () => {
    const file = access("{ not json");
    await expect(editCommentsDocument(file, (doc) => addThread(doc, thread("t1")))).rejects.toThrow(/left as it is/);
    expect(file.writes).toBe(0);
    expect(file.text).toBe("{ not json");
  });

  it("reads again before writing, so a change made elsewhere is kept", async () => {
    const file = access(undefined);
    await editCommentsDocument(file, (doc) => addThread(doc, thread("t1")));
    const stale = await loadCommentsDocument(file);
    await editCommentsDocument(file, (doc) => addThread(doc, thread("t2")));
    await editCommentsDocument(file, (doc) => setThreadResolved(replyToThread(doc, "t1", thread("x").comments[0]!), "t1", true));
    expect(stale?.threads).toHaveLength(1);
    const ids = (await loadCommentsDocument(file))?.threads.map((each) => (each as CommentThread).id);
    expect(ids).toEqual(["t1", "t2"]);
  });
});
