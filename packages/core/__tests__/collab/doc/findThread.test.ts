/** Verifies that a thread finds its text again after edits, live through relative positions and on disk by its quote. */
import * as Y from "yjs";
import { deriveAnchor, deriveLiveAnchor, findThread, type CommentThread } from "../../../src/collab/doc/index";

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
