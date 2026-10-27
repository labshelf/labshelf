/**
 * Verifies that a thread finds its text again after edits, live through relative positions and on disk by its quote.
 * Verifies the comment threads in a share's index doc: edits from two members at once all survive a sync.
 */
import * as Y from "yjs";
import {
  deriveAnchor,
  deriveLiveAnchor,
  findThread,
  type CommentThread,
  addLiveThread,
  readLiveThreads,
  addLiveThreadReply,
  setLiveThreadResolved,
} from "../../src/collab/index";

const text = "We compare against a strong baseline on three datasets and report the mean.";
const start = text.indexOf("a strong baseline");
const end = start + "a strong baseline".length;

const threadOn = (anchor: CommentThread["anchor"]): CommentThread => ({
  id: "t1", file: "main.tex", anchor, comments: [{ id: "c1", author: "Ana", body: "?", createdAt: "2026-10-16T09:12:00.000Z" }], resolved: false,
});

function liveText(content: string): Y.Text {
  const doc = new Y.Doc();
  const yText = doc.getText("content");
  yText.insert(0, content);
  return yText;
}

describe("deriveAnchor", () => {
  it("keeps the quote with up to 32 characters of context", () => {
    expect(deriveAnchor(text, start, end)).toEqual({ quote: "a strong baseline", prefix: "We compare against ", suffix: " on three datasets and report th" });
  });
});

describe("findThread", () => {
  it("follows relative positions when text is inserted before and at the edges of the range", () => {
    const yText = liveText(text);
    const thread = threadOn(deriveLiveAnchor(yText, start, end));
    yText.insert(0, "Intro. ");
    yText.insert(end + 7, "!!");
    yText.insert(start + 7, "[");
    const range = findThread(thread, yText.toString(), yText);
    expect(range).not.toBe("detached");
    if (range === "detached") { return; }
    expect(yText.toString().slice(range.start, range.end)).toBe("a strong baseline");
  });

  it("re-anchors the quote on disk after the text moves", () => {
    const thread = threadOn(deriveAnchor(text, start, end));
    const moved = `Section one.\n\n${text}`;
    const range = findThread(thread, moved);
    expect(range).toEqual({ start: start + 14, end: end + 14 });
  });

  it("picks the occurrence whose context matches", () => {
    const doubled = "a strong baseline is rare. We compare against a strong baseline on three datasets.";
    const range = findThread(threadOn(deriveAnchor(text, start, end)), doubled);
    expect(range).toEqual({ start: doubled.lastIndexOf("a strong baseline"), end: doubled.lastIndexOf("a strong baseline") + 17 });
  });

  it("finds a slightly edited quote approximately", () => {
    const edited = text.replace("a strong baseline", "a strong baselines");
    const range = findThread(threadOn(deriveAnchor(text, start, end)), edited);
    expect(range).not.toBe("detached");
    if (range === "detached") { return; }
    expect(edited.slice(range.start, range.end)).toMatch(/^a strong baseline/);
  });

  it("detaches a thread whose quote was deleted, live and on disk", () => {
    const yText = liveText(text);
    const thread = threadOn(deriveLiveAnchor(yText, start, end));
    yText.delete(start, end - start);
    expect(findThread(thread, yText.toString(), yText)).toBe("detached");
    expect(findThread(threadOn(deriveAnchor(text, start, end)), yText.toString())).toBe("detached");
  });
});

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
    expect(addLiveThreadReply(a, "t1", comment("ra", "2026-10-16T12:00:00.000Z"))).toBe(true);
    expect(addLiveThreadReply(b, "t1", comment("rb", "2026-10-16T12:00:01.000Z"))).toBe(true);
    sync(a, b);
    for (const doc of [a, b]) {
      const threads = readLiveThreads(doc);
      expect(threads.map((each) => each.id)).toEqual(["t1", "t2", "t3"]);
      expect(threads[0]!.comments.map((each) => each.id).sort()).toEqual(["ra", "rb", "t1-c"]);
    }
    expect(readLiveThreads(a)).toEqual(readLiveThreads(b));
  });

  it("resolves and reopens, and reports a missing thread", () => {
    const doc = new Y.Doc();
    addLiveThread(doc, thread("t1", "2026-10-16T09:00:00.000Z"));
    expect(setLiveThreadResolved(doc, "t1", true)).toBe(true);
    expect(readLiveThreads(doc)[0]!.resolved).toBe(true);
    setLiveThreadResolved(doc, "t1", false);
    expect(readLiveThreads(doc)[0]!.resolved).toBe(false);
    expect(addLiveThreadReply(doc, "nope", comment("x", "2026-10-16T09:00:00.000Z"))).toBe(false);
  });
});
