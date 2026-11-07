/**
 * @jest-environment jsdom
 */
// Tests the comment gutter's grouping: one marker per line, whatever number of threads start on it.
import { Text } from "@codemirror/state";
import { groupThreadsByLine } from "../../../src/collab/dom/editorComments";
import type { ThreadRange } from "../../../src/collab/comments";

const doc = Text.of(["first line", "second line with three threads", "third"]);
const thread = (id: string, start: number, end: number): ThreadRange => ({ id, start, end, comments: [{ author: "Ada", body: id, createdAt: "2026-11-06T10:00:00.000Z" }] });

describe("groupThreadsByLine", () => {
  it("puts the threads starting on one line under that line's start, in document order", () => {
    const second = doc.line(2).from;
    const groups = groupThreadsByLine(doc, [thread("c", second + 20, second + 25), thread("a", second, second + 6), thread("b", second + 7, second + 11)]);
    expect([...groups.keys()]).toEqual([second]);
    expect(groups.get(second)!.map((each) => each.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps threads on different lines apart, and a thread spanning lines on the line it starts on", () => {
    const groups = groupThreadsByLine(doc, [thread("a", 2, doc.line(2).from + 3), thread("b", doc.line(3).from, doc.line(3).to)]);
    expect([...groups.entries()].map(([from, threads]) => [from, threads.map((each) => each.id)])).toEqual([[0, ["a"]], [doc.line(3).from, ["b"]]]);
  });

  it("gives no line for no threads", () => {
    expect(groupThreadsByLine(doc, []).size).toBe(0);
  });
});
