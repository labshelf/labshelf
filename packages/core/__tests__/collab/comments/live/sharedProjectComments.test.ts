/** Verifies the comment lifecycle over a shared project's session: threads, placement in live texts, edits and change events. */
import * as Y from "yjs";
import { fileText, indexFiles } from "../../../../src/collab/model/index";
import { sharedProjectComments, type CommentThread } from "../../../../src/collab/comments/index";

function session() {
  const index = new Y.Doc();
  const docs = new Map<string, Y.Doc>();
  const openDoc = (path: string): Y.Doc => { let doc = docs.get(path); if (!doc) { doc = new Y.Doc(); docs.set(path, doc); } return doc; };
  return { index, openDoc, docs };
}

const comment = (id: string) => ({ id, author: "Ana", body: `body ${id}`, createdAt: "2026-10-20T09:00:00.000Z" });

function sharedFile(shared: ReturnType<typeof session>, path: string, text: string): Y.Text {
  indexFiles(shared.index).set(path, { kind: "text" });
  const yText = fileText(shared.openDoc(path));
  yText.insert(0, text);
  return yText;
}

describe("shared project comments", () => {
  it("anchors a thread to the live text so it follows edits made before it", () => {
    const shared = session();
    const yText = sharedFile(shared, "main.tex", "Hello brave world");
    const comments = sharedProjectComments(shared);
    const thread: CommentThread = { id: "t1", file: "main.tex", anchor: comments.anchor("main.tex", { start: 6, end: 11 }), comments: [comment("c1")], resolved: false };
    comments.add(thread);
    yText.insert(0, "Oh. ");
    const [stored] = comments.threads();
    expect(stored?.id).toBe("t1");
    expect(comments.locate(stored!)).toEqual({ start: 10, end: 15 });
  });

  it("detaches a thread whose file the share does not list as text, and reads no text for it", () => {
    const shared = session();
    const comments = sharedProjectComments(shared);
    const thread: CommentThread = { id: "t1", file: "gone.tex", anchor: { quote: "x", prefix: "", suffix: "" }, comments: [comment("c1")], resolved: false };
    comments.add(thread);
    expect(comments.textOf("gone.tex")).toBeUndefined();
    expect(comments.locate(thread)).toBe("detached");
    expect(shared.docs.has("gone.tex")).toBe(false);
  });

  it("replies, resolves and reports every change, and refuses a duplicate or missing thread", () => {
    const shared = session();
    sharedFile(shared, "main.tex", "text");
    const comments = sharedProjectComments(shared);
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
