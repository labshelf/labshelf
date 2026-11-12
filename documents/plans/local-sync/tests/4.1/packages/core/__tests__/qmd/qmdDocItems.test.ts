// Pins the in-place body update of setQmdDocText (4.1a) and the item list and item observer of a qmd doc (4.1b, 4.1c).
import * as Y from "yjs";
import { readQmdDoc, readQmdDocText, setQmdDocText } from "../../src/qmd/sharedQmdDoc";
import { listQmdItems, observeQmdItems } from "../../src/qmd/qmdDocItems";

const fence = (id: string, attrs = ` author="Ana"`): string => `::: {#${id} .labshelf-item${attrs}}`;
const item = (id: string, body: string, attrs?: string): string => `${fence(id, attrs)}\n${body}\n:::\n`;

const A = "n-AAA";
const B = "n-BBB";
const C = "n-CCC";
const base = `Intro text.\n\n${item(A, "First body.")}\n${item(B, "Second body.")}\n${item(C, "Third body.")}`;

const bodies = (doc: Y.Doc): Y.Map<Y.XmlFragment> => readQmdDoc(doc).get("bodies") as Y.Map<Y.XmlFragment>;
const order = (doc: Y.Doc): Y.Array<string> => readQmdDoc(doc).get("order") as Y.Array<string>;
const seeded = (text: string): Y.Doc => { const doc = new Y.Doc(); setQmdDocText(doc, text, "seed"); return doc; };

function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

describe("setQmdDocText on a changed body", () => {
  const THREE = "Para one.\n\nPara two.\n\nPara three.\n";

  it("4.1a keeps the key's fragment instance and returns the new text", () => {
    const doc = seeded(item(A, THREE));
    const before = bodies(doc).get(A);
    expect(before).toBeInstanceOf(Y.XmlFragment);
    const next = item(A, "Para one.\n\nPara two, edited.\n\nPara three.\n");
    setQmdDocText(doc, next, "edit");
    expect(bodies(doc).get(A)).toBe(before);
    expect(readQmdDocText(doc)).toBe(next);
  });

  it("4.1a keeps the unchanged leading and trailing blocks as the same Y types and replaces the span between", () => {
    const doc = seeded(item(A, THREE));
    const fragment = bodies(doc).get(A)!;
    const [first, middle, last] = fragment.toArray();
    setQmdDocText(doc, item(A, "Para one.\n\nPara two, edited.\n\nPara three.\n"), "edit");
    const after = fragment.toArray();
    expect(after).toHaveLength(3);
    expect(after[0]).toBe(first);
    expect(after[2]).toBe(last);
    expect(after[1]).not.toBe(middle);
  });

  it("4.1a keeps the trailing blocks when only the first block changes", () => {
    const doc = seeded(item(A, THREE));
    const fragment = bodies(doc).get(A)!;
    const [, second, third] = fragment.toArray();
    const next = item(A, "Para one, edited.\n\nPara two.\n\nPara three.\n");
    setQmdDocText(doc, next, "edit");
    const after = fragment.toArray();
    expect(after[1]).toBe(second);
    expect(after[2]).toBe(third);
    expect(readQmdDocText(doc)).toBe(next);
  });

  it("4.1a keeps the leading blocks when blocks are added at the end", () => {
    const doc = seeded(item(A, THREE));
    const fragment = bodies(doc).get(A)!;
    const [first, second, third] = fragment.toArray();
    const next = item(A, `${THREE}\nPara four.\n`);
    setQmdDocText(doc, next, "edit");
    const after = fragment.toArray();
    expect(after).toHaveLength(4);
    expect(after[0]).toBe(first);
    expect(after[1]).toBe(second);
    expect(after[2]).toBe(third);
    expect(readQmdDocText(doc)).toBe(next);
  });

  it("4.1a keeps the fragment instance of an item whose body shrinks to one block", () => {
    const doc = seeded(item(A, THREE));
    const fragment = bodies(doc).get(A)!;
    const next = item(A, "Para two.\n");
    setQmdDocText(doc, next, "edit");
    expect(bodies(doc).get(A)).toBe(fragment);
    expect(fragment.length).toBe(1);
    expect(readQmdDocText(doc)).toBe(next);
  });

  it("4.1a leaves the fragments of the other items as they are", () => {
    const doc = seeded(base);
    const [fa, fb, fc] = [bodies(doc).get(A), bodies(doc).get(B), bodies(doc).get(C)];
    const next = base.replace("Second body.", "Second body, changed.");
    setQmdDocText(doc, next, "edit");
    expect(bodies(doc).get(A)).toBe(fa);
    expect(bodies(doc).get(B)).toBe(fb);
    expect(bodies(doc).get(C)).toBe(fc);
    expect(readQmdDocText(doc)).toBe(next);
  });

  it("4.1a still gives a new item its own fragment", () => {
    const doc = seeded(base);
    const next = `${base}\n${item("n-DDD", "Fourth body.")}`;
    setQmdDocText(doc, next, "edit");
    expect(bodies(doc).get("n-DDD")).toBeInstanceOf(Y.XmlFragment);
    expect(readQmdDocText(doc)).toBe(next);
  });

  it("4.1a converges a peer synced by updates to the same text and keeps the peer's fragment instance", () => {
    const a = seeded(item(A, THREE));
    const b = new Y.Doc();
    sync(a, b);
    const peerFragment = bodies(b).get(A);
    const next = item(A, "Para one.\n\nPara two, edited.\n\nPara three.\n");
    setQmdDocText(a, next, "edit");
    sync(a, b);
    expect(readQmdDocText(b)).toBe(next);
    expect(readQmdDocText(a)).toBe(next);
    expect(bodies(b).get(A)).toBe(peerFragment);
  });

  it("4.1a merges two peers' edits to different blocks of one body", () => {
    const a = seeded(item(A, THREE));
    const b = new Y.Doc();
    sync(a, b);
    setQmdDocText(a, item(A, "Para one, by a.\n\nPara two.\n\nPara three.\n"), "a");
    setQmdDocText(b, item(A, "Para one.\n\nPara two.\n\nPara three, by b.\n"), "b");
    sync(a, b);
    expect(readQmdDocText(a)).toBe(readQmdDocText(b));
    expect(readQmdDocText(a)).toBe(item(A, "Para one, by a.\n\nPara two.\n\nPara three, by b.\n"));
  });
});

describe("listQmdItems", () => {
  it("4.1b lists nothing for an empty doc", () => {
    expect(listQmdItems(new Y.Doc())).toEqual([]);
  });

  it("4.1b lists the items in order with key, id, fence and fragment, skipping loose segments", () => {
    const doc = seeded(base);
    const items = listQmdItems(doc);
    expect(items.map((entry) => entry.key)).toEqual([A, B, C]);
    expect(items.map((entry) => entry.id)).toEqual([A, B, C]);
    const attrs = readQmdDoc(doc).get("attrs") as Y.Map<string>;
    expect(items.map((entry) => entry.fence)).toEqual([attrs.get(A), attrs.get(B), attrs.get(C)]);
    expect(items[0]!.fence).toContain(fence(A));
    items.forEach((entry) => { expect(entry.fragment).toBe(bodies(doc).get(entry.key)); });
  });

  it("4.1b returns each fence as stored in attrs", () => {
    const doc = seeded(`${item(A, "x", ` author="Ana" created="2026-03-04T10:00:00Z"`)}\n${item(B, "y")}`);
    const attrs = readQmdDoc(doc).get("attrs") as Y.Map<string>;
    const items = listQmdItems(doc);
    expect(items[0]!.fence).toBe(attrs.get(A));
    expect(items[0]!.fence).toContain(`#${A}`);
    expect(items[0]!.fence).toContain(`created="2026-03-04T10:00:00Z"`);
    expect(items[1]!.fence).toBe(attrs.get(B));
  });

  it("4.1b follows the doc's order after items move", () => {
    const doc = seeded(base);
    setQmdDocText(doc, `${item(C, "Third body.")}\n${item(A, "First body.")}\n${item(B, "Second body.")}`, "edit");
    expect(listQmdItems(doc).map((entry) => entry.key)).toEqual([C, A, B]);
  });

  it("4.1b lists a repeated key once, at its first place", () => {
    const doc = seeded(base);
    order(doc).push([A]);
    const keys = listQmdItems(doc).map((entry) => entry.key);
    expect(keys).toEqual([A, B, C]);
  });

  it("4.1b lists two items with the same id under different keys, both with that id", () => {
    const doc = seeded(`${item(A, "One.")}\n${item(A, "Two.")}`);
    const items = listQmdItems(doc);
    expect(items).toHaveLength(2);
    expect(items.map((entry) => entry.id)).toEqual([A, A]);
    expect(items[0]!.key).toBe(A);
    expect(items[1]!.key).toMatch(/^n-AAA~\d+$/);
    expect(items[1]!.fragment).not.toBe(items[0]!.fragment);
  });

  it("4.1b skips a key that has no fence line or no fragment", () => {
    const doc = seeded(base);
    doc.transact(() => {
      order(doc).push(["ghost"]);
      bodies(doc).delete(B);
    });
    expect(listQmdItems(doc).map((entry) => entry.key)).toEqual([A, C]);
  });
});

describe("observeQmdItems", () => {
  function watch(text: string = base): { doc: Y.Doc; listener: jest.Mock; stop: () => void } {
    const doc = seeded(text);
    const listener = jest.fn();
    const stop = observeQmdItems(doc, listener);
    return { doc, listener, stop };
  }

  it("4.1c does not fire on subscribing", () => {
    expect(watch().listener).not.toHaveBeenCalled();
  });

  it("4.1c fires when an item is added", () => {
    const { doc, listener } = watch();
    setQmdDocText(doc, `${base}\n${item("n-DDD", "Fourth body.")}`, "edit");
    expect(listener).toHaveBeenCalled();
    expect(listQmdItems(doc).map((entry) => entry.key)).toEqual([A, B, C, "n-DDD"]);
  });

  it("4.1c fires when an item is removed", () => {
    const { doc, listener } = watch();
    setQmdDocText(doc, `Intro text.\n\n${item(A, "First body.")}\n${item(C, "Third body.")}`, "edit");
    expect(listener).toHaveBeenCalled();
  });

  it("4.1c fires when items are reordered", () => {
    const { doc, listener } = watch();
    setQmdDocText(doc, `Intro text.\n\n${item(B, "Second body.")}\n${item(A, "First body.")}\n${item(C, "Third body.")}`, "edit");
    expect(listener).toHaveBeenCalled();
    expect(listQmdItems(doc).map((entry) => entry.key)).toEqual([B, A, C]);
  });

  it("4.1c fires when an item's fence changes", () => {
    const { doc, listener } = watch();
    setQmdDocText(doc, base.replace(`#${B} .labshelf-item author="Ana"`, `#${B} .labshelf-item author="Bo"`), "edit");
    expect(listener).toHaveBeenCalled();
    expect(listQmdItems(doc).find((entry) => entry.key === B)!.fence).toContain(`author="Bo"`);
  });

  it("4.1c fires when an item's fragment is replaced by another", () => {
    const { doc, listener } = watch();
    doc.transact(() => { bodies(doc).set(B, new Y.XmlFragment()); });
    expect(listener).toHaveBeenCalled();
  });

  it("4.1c fires when a peer's update adds an item", () => {
    const { doc, listener } = watch();
    const peer = new Y.Doc();
    sync(doc, peer);
    setQmdDocText(peer, `${base}\n${item("n-DDD", "Fourth body.")}`, "peer");
    listener.mockClear();
    sync(peer, doc);
    expect(listener).toHaveBeenCalled();
  });

  it("4.1c does not fire on an edit inside a fragment", () => {
    const { doc, listener } = watch();
    const fragment = bodies(doc).get(B)!;
    doc.transact(() => { fragment.insert(0, [new Y.XmlElement("paragraph")]); });
    expect(listener).not.toHaveBeenCalled();
  });

  it("4.1c does not fire on a body change that keeps the fragment", () => {
    const { doc, listener } = watch();
    setQmdDocText(doc, base.replace("Second body.", "Second body, changed."), "edit");
    expect(readQmdDocText(doc)).toContain("Second body, changed.");
    expect(listener).not.toHaveBeenCalled();
  });

  it("4.1c does not fire when the same text is set again", () => {
    const { doc, listener } = watch();
    setQmdDocText(doc, base, "edit");
    expect(listener).not.toHaveBeenCalled();
  });

  it("4.1c stops firing after unsubscribe", () => {
    const { doc, listener, stop } = watch();
    stop();
    setQmdDocText(doc, `${base}\n${item("n-DDD", "Fourth body.")}`, "edit");
    expect(listener).not.toHaveBeenCalled();
  });
});
