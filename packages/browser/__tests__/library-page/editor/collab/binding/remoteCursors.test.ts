/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// A peer's caret in a shared file carries a visible label with the peer's name.
import { EditorView } from "@codemirror/view";
import { toRelativeSelection, type PresenceHandle, type PresenceState } from "@labshelf/core";
import * as Y from "yjs";
import { remoteCursors } from "../../../../../src/library-page/editor/collab/binding/remoteCursors";

function editorWithPeer(name: string): EditorView {
  const doc = new Y.Doc();
  const text = doc.getText("content");
  text.insert(0, "hello world");
  const selection = toRelativeSelection(text, { anchor: 5, head: 5 });
  const peer: PresenceState = { name, colour: "", file: "main.tex", ...selection };
  const presence = {
    awareness: { on: jest.fn(), off: jest.fn() },
    remote: () => new Map([[7, peer]]),
  } as unknown as PresenceHandle;
  const parent = document.createElement("div");
  document.body.replaceChildren(parent);
  return new EditorView({ doc: text.toString(), parent, extensions: [remoteCursors({ text, presence, file: "main.tex" })] });
}

describe("remoteCursors", () => {
  it("labels a peer's caret with the peer's name", () => {
    const view = editorWithPeer("Ada");
    const label = view.dom.querySelector(".ls-peer-caret .ls-peer-caret-label");
    expect(label?.textContent).toBe("Ada");
    view.destroy();
  });
});
