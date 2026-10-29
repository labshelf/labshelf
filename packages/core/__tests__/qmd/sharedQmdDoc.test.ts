// Pins the Yjs doc of a shared .qmd file: items as ProseMirror fragments, item-level edits that merge, and a byte-exact text round trip.
import * as Y from "yjs";
import { yXmlFragmentToProsemirrorJSON } from "y-prosemirror";
import { readQmdDoc, readQmdDocText, setQmdDocText } from "../../src/qmd/sharedQmdDoc";
import { docToBody, qmdSchema } from "../../src/qmd/editor/index";
import { parseItemFile, type ItemSegment } from "../../src/qmd/item/itemFile";
import { qmdFixtures, readQmdFixture } from "./fixtures/qmdFixtures";

const items = (text: string): ItemSegment[] => parseItemFile(text).segments.filter((segment): segment is ItemSegment => segment.kind === "item");

const item = (id: string, body: string): string => `::: {#${id} .labshelf-item author="Ana"}\n${body}\n:::\n`;

const base = `Intro text.\n\n${item("n-AAA", "First body.")}\n${item("n-BBB", "Second body.")}\n${item("n-CCC", "Third body.")}`;

function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

function pair(text: string): { a: Y.Doc; b: Y.Doc } {
  const a = new Y.Doc();
  setQmdDocText(a, text, "seed");
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return { a, b };
}

describe("shared qmd doc layout", () => {
  it("8.4b holds the doc in a Y.Map named qmd with order, attrs and bodies", () => {
    const doc = new Y.Doc();
    setQmdDocText(doc, base, "seed");
    const qmd = readQmdDoc(doc);
    expect(qmd).toBe(doc.getMap("qmd"));
    expect(qmd.get("order")).toBeInstanceOf(Y.Array);
    expect(qmd.get("attrs")).toBeInstanceOf(Y.Map);
    expect(qmd.get("bodies")).toBeInstanceOf(Y.Map);
  });

  it("8.4b keys the order by item id and loose-<n> for loose segments", () => {
    for (const { name, text } of qmdFixtures()) {
      const doc = new Y.Doc();
      setQmdDocText(doc, text, "seed");
      const order = (readQmdDoc(doc).get("order") as Y.Array<string>).toArray();
      const segments = parseItemFile(text).segments;
      expect({ name, length: order.length }).toEqual({ name, length: segments.length });
      segments.forEach((segment, index) => {
        if (segment.kind === "item") { expect({ name, key: order[index] }).toEqual({ name, key: segment.id }); }
        else { expect(order[index]).toMatch(/^loose-\d+$/); }
      });
      expect(new Set(order).size).toBe(order.length);
    }
  });

  it("8.4b stores the exact fence line of each item in attrs", () => {
    const text = readQmdFixture("notes-math.qmd");
    const doc = new Y.Doc();
    setQmdDocText(doc, text, "seed");
    const attrs = readQmdDoc(doc).get("attrs") as Y.Map<string>;
    for (const parsed of items(text)) { expect(attrs.get(parsed.id)).toBe(parsed.fence); }
  });

  it("8.4b stores each item body as a ProseMirror Y.XmlFragment that writes back to the body", () => {
    const text = readQmdFixture("notes-math.qmd");
    const doc = new Y.Doc();
    setQmdDocText(doc, text, "seed");
    const bodies = readQmdDoc(doc).get("bodies") as Y.Map<Y.XmlFragment>;
    for (const parsed of items(text)) {
      const fragment = bodies.get(parsed.id);
      expect(fragment).toBeInstanceOf(Y.XmlFragment);
      const node = qmdSchema.nodeFromJSON(yXmlFragmentToProsemirrorJSON(fragment!));
      expect(docToBody(node)).toBe(parsed.body);
    }
  });

  it("8.4b does not create a Y.Text content for a qmd doc", () => {
    const doc = new Y.Doc();
    setQmdDocText(doc, base, "seed");
    expect(doc.share.has("content")).toBe(false);
  });

  it("8.4b reads an empty doc as empty text", () => {
    expect(readQmdDocText(new Y.Doc())).toBe("");
  });
});

describe("shared qmd doc text round trip", () => {
  it.each(qmdFixtures().map((fixture) => [fixture.name, fixture.text] as const))("8.4b reads back %s byte for byte", (_name, text) => {
    const doc = new Y.Doc();
    setQmdDocText(doc, text, "seed");
    expect(readQmdDocText(doc)).toBe(text);
  });

  it.each(qmdFixtures().map((fixture) => [fixture.name, fixture.text] as const))("8.4b reads %s byte for byte on a peer that applied the update", (_name, text) => {
    const doc = new Y.Doc();
    setQmdDocText(doc, text, "seed");
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    expect(readQmdDocText(peer)).toBe(text);
  });

  it("8.4b reads back an empty text", () => {
    const doc = new Y.Doc();
    setQmdDocText(doc, "", "seed");
    expect(readQmdDocText(doc)).toBe("");
  });
});

describe("setQmdDocText", () => {
  it("8.4b makes one transaction under the given origin", () => {
    const doc = new Y.Doc();
    const origin = { name: "disk" };
    const origins: unknown[] = [];
    doc.on("update", (_update: Uint8Array, from: unknown) => origins.push(from));
    setQmdDocText(doc, base, origin);
    expect(origins).toEqual([origin]);
  });

  it("8.4b sends no update when the text is unchanged", () => {
    const doc = new Y.Doc();
    setQmdDocText(doc, base, "seed");
    const updates: Uint8Array[] = [];
    doc.on("update", (update: Uint8Array) => updates.push(update));
    setQmdDocText(doc, base, "again");
    expect(updates).toEqual([]);
  });

  it("8.4b replaces only the body of the item that changed", () => {
    const doc = new Y.Doc();
    setQmdDocText(doc, base, "seed");
    const bodies = readQmdDoc(doc).get("bodies") as Y.Map<Y.XmlFragment>;
    const second = bodies.get("n-BBB");
    const third = bodies.get("n-CCC");
    const edited = base.replace("First body.", "First body, edited.");
    setQmdDocText(doc, edited, "edit");
    expect(readQmdDocText(doc)).toBe(edited);
    expect(bodies.get("n-BBB")).toBe(second);
    expect(bodies.get("n-CCC")).toBe(third);
  });

  it("8.4b updates the fence line when only the attributes change", () => {
    const doc = new Y.Doc();
    setQmdDocText(doc, base, "seed");
    const edited = base.replace('#n-BBB .labshelf-item author="Ana"', '#n-BBB .labshelf-item author="Bruno"');
    setQmdDocText(doc, edited, "edit");
    expect(readQmdDocText(doc)).toBe(edited);
    expect((readQmdDoc(doc).get("attrs") as Y.Map<string>).get("n-BBB")).toContain('author="Bruno"');
  });

  it("8.4b removes an item from order, attrs and bodies", () => {
    const doc = new Y.Doc();
    setQmdDocText(doc, base, "seed");
    const edited = base.replace(`\n${item("n-BBB", "Second body.")}`, "");
    expect(edited).not.toContain("n-BBB");
    setQmdDocText(doc, edited, "edit");
    const qmd = readQmdDoc(doc);
    expect(readQmdDocText(doc)).toBe(edited);
    expect((qmd.get("order") as Y.Array<string>).toArray()).not.toContain("n-BBB");
    expect((qmd.get("attrs") as Y.Map<string>).has("n-BBB")).toBe(false);
    expect((qmd.get("bodies") as Y.Map<unknown>).has("n-BBB")).toBe(false);
  });

  it("8.4b adds an item and keeps the bodies of the others", () => {
    const doc = new Y.Doc();
    setQmdDocText(doc, base, "seed");
    const bodies = readQmdDoc(doc).get("bodies") as Y.Map<Y.XmlFragment>;
    const first = bodies.get("n-AAA");
    const edited = `${base}\n${item("n-DDD", "Fourth body.")}`;
    setQmdDocText(doc, edited, "edit");
    expect(readQmdDocText(doc)).toBe(edited);
    expect(bodies.get("n-DDD")).toBeInstanceOf(Y.XmlFragment);
    expect(bodies.get("n-AAA")).toBe(first);
  });

  it("8.4b reorders items without replacing their bodies", () => {
    const text = `${item("n-AAA", "First body.")}${item("n-BBB", "Second body.")}`;
    const swapped = `${item("n-BBB", "Second body.")}${item("n-AAA", "First body.")}`;
    const doc = new Y.Doc();
    setQmdDocText(doc, text, "seed");
    const bodies = readQmdDoc(doc).get("bodies") as Y.Map<Y.XmlFragment>;
    const first = bodies.get("n-AAA");
    const second = bodies.get("n-BBB");
    setQmdDocText(doc, swapped, "edit");
    expect(readQmdDocText(doc)).toBe(swapped);
    expect((readQmdDoc(doc).get("order") as Y.Array<string>).toArray()).toEqual(["n-BBB", "n-AAA"]);
    expect(bodies.get("n-AAA")).toBe(first);
    expect(bodies.get("n-BBB")).toBe(second);
  });

  it("8.4b changes loose text between items", () => {
    const doc = new Y.Doc();
    setQmdDocText(doc, base, "seed");
    const edited = base.replace("Intro text.", "A longer introduction.");
    setQmdDocText(doc, edited, "edit");
    expect(readQmdDocText(doc)).toBe(edited);
  });
});

describe("two peers editing a qmd doc", () => {
  it("8.4a converge when they edit different items concurrently", () => {
    const { a, b } = pair(base);
    const forA = base.replace("First body.", "First body by A.");
    const forB = base.replace("Third body.", "Third body by B.");
    setQmdDocText(a, forA, "a");
    setQmdDocText(b, forB, "b");
    sync(a, b);
    const merged = base.replace("First body.", "First body by A.").replace("Third body.", "Third body by B.");
    expect(readQmdDocText(a)).toBe(merged);
    expect(readQmdDocText(b)).toBe(merged);
  });

  it("8.4a converge when one peer edits an item and the other changes the attributes of another", () => {
    const { a, b } = pair(base);
    setQmdDocText(a, base.replace("Second body.", "Second body by A."), "a");
    setQmdDocText(b, base.replace('#n-CCC .labshelf-item author="Ana"', '#n-CCC .labshelf-item author="Bruno"'), "b");
    sync(a, b);
    const merged = base.replace("Second body.", "Second body by A.").replace('#n-CCC .labshelf-item author="Ana"', '#n-CCC .labshelf-item author="Bruno"');
    expect(readQmdDocText(a)).toBe(merged);
    expect(readQmdDocText(b)).toBe(merged);
  });

  it("8.4a converge when one peer adds an item while the other edits one", () => {
    const { a, b } = pair(base);
    setQmdDocText(a, `${base}\n${item("n-DDD", "Fourth body.")}`, "a");
    setQmdDocText(b, base.replace("First body.", "First body by B."), "b");
    sync(a, b);
    const merged = `${base.replace("First body.", "First body by B.")}\n${item("n-DDD", "Fourth body.")}`;
    expect(readQmdDocText(a)).toBe(merged);
    expect(readQmdDocText(b)).toBe(merged);
  });

  it("8.4a converge when one peer removes an item while the other edits another", () => {
    const { a, b } = pair(base);
    setQmdDocText(a, base.replace(`\n${item("n-CCC", "Third body.")}`, ""), "a");
    setQmdDocText(b, base.replace("First body.", "First body by B."), "b");
    sync(a, b);
    expect(readQmdDocText(a)).toBe(readQmdDocText(b));
    expect(readQmdDocText(a)).toContain("First body by B.");
    expect(readQmdDocText(a)).not.toContain("n-CCC");
  });

  it("8.4a converge on the same text when both peers edit the same item", () => {
    const { a, b } = pair(base);
    setQmdDocText(a, base.replace("Second body.", "Second body by A."), "a");
    setQmdDocText(b, base.replace("Second body.", "Second body by B."), "b");
    sync(a, b);
    expect(readQmdDocText(a)).toBe(readQmdDocText(b));
    expect(readQmdDocText(a)).toContain("First body.");
    expect(readQmdDocText(a)).toContain("Third body.");
  });

  it("8.4a keep a concurrent edit after the update travels in the other order", () => {
    const { a, b } = pair(base);
    const updatesA: Uint8Array[] = [];
    const updatesB: Uint8Array[] = [];
    a.on("update", (update: Uint8Array) => updatesA.push(update));
    b.on("update", (update: Uint8Array) => updatesB.push(update));
    setQmdDocText(a, base.replace("First body.", "First body by A."), "a");
    setQmdDocText(b, base.replace("Second body.", "Second body by B."), "b");
    updatesB.forEach((update) => Y.applyUpdate(a, update));
    updatesA.slice().reverse().forEach((update) => Y.applyUpdate(b, update));
    expect(readQmdDocText(a)).toBe(readQmdDocText(b));
    expect(readQmdDocText(a)).toBe(base.replace("First body.", "First body by A.").replace("Second body.", "Second body by B."));
  });
});
