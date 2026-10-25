/** Pins that a file doc's text changes by one minimal edit around the common prefix and suffix. */
import * as Y from "yjs";
import { readFileText, setFileText } from "../../../src/collab/model/index";

function docWith(text: string): Y.Doc {
  const doc = new Y.Doc();
  readFileText(doc).insert(0, text);
  return doc;
}

describe("setFileText", () => {
  it("changes only the differing middle, in one transaction with the given origin", () => {
    const before = "a".repeat(5000) + "OLD" + "b".repeat(5000);
    const doc = docWith(before);
    const updates: { update: Uint8Array; origin: unknown }[] = [];
    doc.on("update", (update: Uint8Array, origin: unknown) => updates.push({ update, origin }));
    const deltas: unknown[] = [];
    readFileText(doc).observe((event: Y.YTextEvent) => deltas.push(event.delta));
    setFileText(doc, "a".repeat(5000) + "NEW!" + "b".repeat(5000), "disk");
    expect(readFileText(doc).toString()).toBe("a".repeat(5000) + "NEW!" + "b".repeat(5000));
    expect(updates).toHaveLength(1);
    expect(updates[0]!.origin).toBe("disk");
    expect(updates[0]!.update.length).toBeLessThan(100);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toHaveLength(3);
    expect(deltas[0]).toEqual(expect.arrayContaining([{ retain: 5000 }, { insert: "NEW!" }, { delete: 3 }]));
  });

  it("makes no update when the text is unchanged", () => {
    const doc = docWith("same");
    const updates = jest.fn();
    doc.on("update", updates);
    setFileText(doc, "same", "disk");
    expect(updates).not.toHaveBeenCalled();
  });

  it("never splits a surrogate pair", () => {
    const doc = docWith("x\u{1F600}y");
    setFileText(doc, "x\u{1F601}y", "disk");
    expect(readFileText(doc).toString()).toBe("x\u{1F601}y");
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    expect(readFileText(copy).toString()).toBe("x\u{1F601}y");
  });
});
