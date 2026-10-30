/** @jest-environment jsdom */
import { history, redo, undo } from "@codemirror/commands";
import { type AnnotationType, EditorState, StateEffect, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ySyncAnnotation } from "y-codemirror.next";
import { fromDisk } from "../../../../src/writing/dom/sourceEditor/openEditors.js";
import { createReviewTracking, reviewEdit, type ReviewTracking } from "../../../../src/writing/dom/sourceEditor/review.js";

const ySync = ySyncAnnotation as unknown as AnnotationType<unknown>;

interface Harness { view: EditorView; tracking: ReviewTracking; setAuthor(name: string): void }

function setup(doc = "hello world", mode: "editing" | "reviewing" = "reviewing"): Harness {
  let author = "ana";
  let counter = 0;
  const tracking = createReviewTracking({ author: () => author, now: () => "T", newId: () => `c${++counter}` });
  const view = new EditorView({ state: EditorState.create({ doc, extensions: [history(), tracking.extension] }) });
  tracking.setMode(view, mode);
  return { view, tracking, setAuthor: (name) => { author = name; } };
}

const type = (view: EditorView, from: number, insert: string, to = from): void => {
  view.dispatch({ changes: { from, to, insert }, userEvent: "input.type" });
};
const del = (view: EditorView, from: number, to: number): void => {
  view.dispatch({ changes: { from, to }, userEvent: "delete.backward" });
};
const text = (view: EditorView): string => view.state.doc.toString();

describe("createReviewTracking: recording (2.1a)", () => {
  it("records nothing in Editing", () => {
    const { view, tracking } = setup("hello world", "editing");
    type(view, 5, "XY");
    del(view, 0, 1);
    expect(tracking.changes(view.state)).toEqual([]);
  });

  it("records typing as an insert with author and created", () => {
    const { view, tracking } = setup();
    type(view, 5, "XY");
    expect(text(view)).toBe("helloXY world");
    expect(tracking.changes(view.state)).toEqual([{ id: "c1", kind: "insert", from: 5, to: 7, author: "ana", created: "T" }]);
  });

  it("records a deletion as a delete at one position holding the text", () => {
    const { view, tracking } = setup();
    del(view, 0, 5);
    expect(tracking.changes(view.state)).toEqual([{ id: "c1", kind: "delete", from: 0, to: 0, text: "hello", author: "ana", created: "T" }]);
  });

  it("records a replacement as a delete and an insert of one group", () => {
    const { view, tracking } = setup();
    type(view, 0, "howdy", 5);
    const records = tracking.changes(view.state);
    expect(records).toHaveLength(2);
    const [deletion, insertion] = records;
    expect(deletion).toMatchObject({ kind: "delete", from: 0, to: 0, text: "hello", author: "ana", created: "T" });
    expect(insertion).toMatchObject({ kind: "insert", from: 0, to: 5, author: "ana", created: "T" });
    expect(insertion?.text).toBeUndefined();
    expect(deletion?.group).toBeDefined();
    expect(insertion?.group).toBe(deletion?.group);
  });

  it("records the reviewEdit annotation and move.drop events, not other untagged changes", () => {
    const { view, tracking } = setup();
    view.dispatch({ changes: { from: 0, insert: "A" }, annotations: reviewEdit.of(true) });
    view.dispatch({ changes: { from: 1, to: 6 }, userEvent: "move.drop" });
    view.dispatch({ changes: { from: 0, insert: "Z" } });
    expect(text(view)).toBe("ZA world");
    expect(tracking.changes(view.state).map((r) => [r.kind, r.from, r.to, r.text])).toEqual([
      ["insert", 1, 2, undefined],
      ["delete", 2, 2, "hello"],
    ]);
  });

  it("stops recording after switching back to Editing", () => {
    const { view, tracking } = setup();
    type(view, 0, "A");
    tracking.setMode(view, "editing");
    type(view, 11, "B");
    expect(tracking.changes(view.state)).toHaveLength(1);
  });
});

describe("createReviewTracking: extend, shrink, drop and merge (2.1b)", () => {
  it("extends the author's own insert when typing at either edge", () => {
    const { view, tracking } = setup();
    type(view, 5, "a");
    type(view, 6, "b");
    type(view, 5, "c");
    expect(text(view)).toBe("hellocab world");
    expect(tracking.changes(view.state)).toEqual([{ id: "c1", kind: "insert", from: 5, to: 8, author: "ana", created: "T" }]);
  });

  it("does not extend another author's insert", () => {
    const { view, tracking, setAuthor } = setup();
    type(view, 5, "a");
    setAuthor("bo");
    type(view, 6, "b");
    expect(tracking.changes(view.state).map((r) => [r.author, r.from, r.to])).toEqual([["ana", 5, 6], ["bo", 6, 7]]);
  });

  it("shrinks the author's own insert on a delete inside it and adds no delete", () => {
    const { view, tracking } = setup();
    type(view, 5, "abc");
    del(view, 6, 7);
    expect(text(view)).toBe("helloac world");
    expect(tracking.changes(view.state)).toEqual([{ id: "c1", kind: "insert", from: 5, to: 7, author: "ana", created: "T" }]);
  });

  it("drops an insert that becomes empty", () => {
    const { view, tracking } = setup();
    type(view, 5, "ab");
    del(view, 5, 7);
    expect(text(view)).toBe("hello world");
    expect(tracking.changes(view.state)).toEqual([]);
  });

  it("records only the original text when a delete spans an own insert and original text", () => {
    const { view, tracking } = setup();
    type(view, 5, "ab");
    del(view, 3, 7);
    expect(text(view)).toBe("hel world");
    expect(tracking.changes(view.state).map((r) => [r.kind, r.from, r.text])).toEqual([["delete", 3, "lo"]]);
  });

  it("merges deletes across a delete's position into one in document order", () => {
    const { view, tracking } = setup();
    del(view, 5, 6);
    del(view, 4, 5);
    view.dispatch({ changes: { from: 4, to: 5 }, userEvent: "delete.forward" });
    expect(text(view)).toBe("hellorld");
    const records = tracking.changes(view.state);
    expect(records).toEqual([{ id: "c1", kind: "delete", from: 4, to: 4, text: "o w", author: "ana", created: "T" }]);
  });

  it("merges two deletes crossed by one deletion", () => {
    const { view, tracking } = setup("abcdefg");
    del(view, 1, 2);
    del(view, 3, 4);
    expect(text(view)).toBe("acdfg");
    del(view, 0, 5);
    expect(tracking.changes(view.state).map((r) => [r.kind, r.from, r.text])).toEqual([["delete", 0, "abcdefg"]]);
  });
});

describe("createReviewTracking: exempt transactions (2.1c)", () => {
  it("does not record fromDisk, remote or ySync transactions but maps records through them", () => {
    const { view, tracking } = setup();
    type(view, 6, "X");
    view.dispatch({ changes: { from: 0, insert: "1" }, userEvent: "input", annotations: fromDisk.of(true) });
    view.dispatch({ changes: { from: 0, insert: "2" }, userEvent: "input", annotations: Transaction.remote.of(true) });
    view.dispatch({ changes: { from: 0, insert: "3" }, userEvent: "input", annotations: ySync.of({}) });
    expect(text(view)).toBe("321hello Xworld");
    expect(tracking.changes(view.state)).toEqual([{ id: "c1", kind: "insert", from: 9, to: 10, author: "ana", created: "T" }]);
  });

  it("does not record undo or redo, and an undo drops the change it reverts", () => {
    const { view, tracking } = setup();
    type(view, 5, "XY");
    expect(undo(view)).toBe(true);
    expect(text(view)).toBe("hello world");
    expect(tracking.changes(view.state)).toEqual([]);
    expect(redo(view)).toBe(true);
    expect(text(view)).toBe("helloXY world");
    expect(tracking.changes(view.state)).toEqual([]);
  });

  it("drops a delete when an undo puts back exactly its text at its position", () => {
    const { view, tracking } = setup();
    del(view, 0, 5);
    expect(undo(view)).toBe(true);
    expect(text(view)).toBe("hello world");
    expect(tracking.changes(view.state)).toEqual([]);
  });

  it("drops both halves of a replacement on undo", () => {
    const { view, tracking } = setup();
    type(view, 0, "howdy", 5);
    expect(undo(view)).toBe(true);
    expect(text(view)).toBe("hello world");
    expect(tracking.changes(view.state)).toEqual([]);
  });
});

describe("createReviewTracking: accept and reject (2.1d)", () => {
  it("accepts one change: keeps the text, drops the record", () => {
    const { view, tracking } = setup();
    type(view, 5, "X");
    del(view, 7, 9);
    const [insertion] = tracking.changes(view.state);
    tracking.accept(view, [insertion!.id]);
    expect(text(view)).toBe("helloX rld");
    expect(tracking.changes(view.state).map((r) => r.kind)).toEqual(["delete"]);
  });

  it("rejects an insert and a delete one at a time", () => {
    const { view, tracking } = setup();
    type(view, 5, "X");
    del(view, 7, 9);
    const insertion = tracking.changes(view.state).find((r) => r.kind === "insert")!;
    tracking.reject(view, [insertion.id]);
    expect(text(view)).toBe("hello rld");
    const deletion = tracking.changes(view.state).find((r) => r.kind === "delete")!;
    expect(deletion).toMatchObject({ from: 6, text: "wo" });
    tracking.reject(view, [deletion.id]);
    expect(text(view)).toBe("hello world");
    expect(tracking.changes(view.state)).toEqual([]);
  });

  it("rejects a whole group from one of its ids", () => {
    const { view, tracking } = setup();
    type(view, 0, "howdy", 5);
    const insertion = tracking.changes(view.state).find((r) => r.kind === "insert")!;
    tracking.reject(view, [insertion.id]);
    expect(text(view)).toBe("hello world");
    expect(tracking.changes(view.state)).toEqual([]);
  });

  it("accepts a whole group from one of its ids", () => {
    const { view, tracking } = setup();
    type(view, 0, "howdy", 5);
    const deletion = tracking.changes(view.state).find((r) => r.kind === "delete")!;
    tracking.accept(view, [deletion.id]);
    expect(text(view)).toBe("howdy world");
    expect(tracking.changes(view.state)).toEqual([]);
  });

  it("rejects all changes in one untracked transaction kept out of history", () => {
    const { view, tracking } = setup();
    type(view, 0, "howdy", 5);
    type(view, 11, "!");
    del(view, 6, 7);
    const dispatched: Transaction[] = [];
    view.dispatch({ effects: StateEffect.appendConfig.of(EditorView.updateListener.of((update) => { dispatched.push(...update.transactions); })) });
    dispatched.length = 0;
    tracking.reject(view, tracking.changes(view.state).map((r) => r.id));
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.annotation(Transaction.addToHistory)).toBe(false);
    expect(text(view)).toBe("hello world");
    expect(tracking.changes(view.state)).toEqual([]);
  });

  it("accepts all changes, keeping the text", () => {
    const { view, tracking } = setup();
    type(view, 0, "howdy", 5);
    del(view, 6, 7);
    tracking.accept(view, tracking.changes(view.state).map((r) => r.id));
    expect(text(view)).toBe("howdy orld");
    expect(tracking.changes(view.state)).toEqual([]);
  });
});

describe("createReviewTracking: D4 (A2)", () => {
  it("load replaces every record", () => {
    const { view, tracking } = setup();
    type(view, 0, "A");
    const loaded = [{ id: "s1", kind: "delete" as const, from: 3, to: 3, text: "x", author: "bo", created: "T0" }];
    tracking.load(view, loaded);
    expect(tracking.changes(view.state)).toEqual(loaded);
  });

  it("maps every record through an untracked edit in Editing", () => {
    const { view, tracking } = setup();
    type(view, 6, "X");
    del(view, 9, 10);
    tracking.setMode(view, "editing");
    type(view, 0, ">>");
    expect(tracking.changes(view.state).map((r) => [r.kind, r.from, r.to])).toEqual([["insert", 8, 9], ["delete", 11, 11]]);
  });

  it("records each change of a multi-change transaction", () => {
    const { view, tracking } = setup();
    view.dispatch({ changes: [{ from: 0, insert: "A" }, { from: 6, to: 11 }], userEvent: "input.type" });
    expect(text(view)).toBe("Ahello ");
    expect(tracking.changes(view.state).map((r) => [r.kind, r.from, r.to, r.text])).toEqual([
      ["insert", 0, 1, undefined],
      ["delete", 7, 7, "world"],
    ]);
  });
});
