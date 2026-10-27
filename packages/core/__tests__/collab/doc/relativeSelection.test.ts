/** Pins peer selections as base64 relative positions: they follow concurrent edits and reject untrusted input. */
import * as Y from "yjs";
import { deriveAbsoluteSelection, deriveRelativeSelection } from "../../../src/collab/doc/index";

describe("relative selections", () => {
  it("keeps pointing at the same text after a concurrent insert before it", () => {
    const doc = new Y.Doc();
    const text = doc.getText("file");
    text.insert(0, "hello world");
    const relative = deriveRelativeSelection(text, { anchor: 6, head: 11 });
    text.insert(0, ">> ");
    expect(deriveAbsoluteSelection(text, relative)).toEqual({ anchor: 9, head: 14 });
  });

  it("resolves a selection encoded on another replica", () => {
    const doc = new Y.Doc();
    doc.getText("file").insert(0, "abc");
    const replica = new Y.Doc();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc));
    const relative = deriveRelativeSelection(doc.getText("file"), { anchor: 1, head: 2 });
    expect(deriveAbsoluteSelection(replica.getText("file"), relative)).toEqual({ anchor: 1, head: 2 });
  });

  it("returns null for text that is not a relative position, or one into another type", () => {
    const doc = new Y.Doc();
    const text = doc.getText("file");
    const other = doc.getText("other");
    other.insert(0, "xyz");
    expect(deriveAbsoluteSelection(text, { anchor: "not base64!", head: "AA==" })).toBeNull();
    expect(deriveAbsoluteSelection(text, deriveRelativeSelection(other, { anchor: 1, head: 1 }))).toBeNull();
  });
});
