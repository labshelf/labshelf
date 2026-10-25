/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Undo in an editor bound to a shared text reverts only this user's edits, whatever peers write in between.
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { type PresenceStore, deriveRelativeSelection, type PresenceState } from "@labshelf/core";
import { yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";
import { collabExtensions } from "../../src/collab/collabExtensions";
import { remoteCursors } from "../../src/collab/collabExtensions";

const presence = {
  awareness: { clientID: 7, on: () => undefined, off: () => undefined, getStates: () => new Map() },
  setLocal: () => undefined,
  remote: () => new Map(),
} as unknown as PresenceStore;

const command = (key: string) => yUndoManagerKeymap.find((binding) => binding.key === key)!.run!;

function bound(initial: string) {
  const doc = new Y.Doc();
  const text = doc.getText("content");
  text.insert(0, initial);
  const view = new EditorView({ state: EditorState.create({ doc: initial, extensions: collabExtensions({ text, presence, file: "main.tex", name: "Ada" }) }) });
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  peer.on("update", (update: Uint8Array) => Y.applyUpdate(doc, update, "relay"));
  return { doc, text, view, peerText: peer.getText("content") };
}

describe("undo in a shared editor", () => {
  it("reverts own edits only, with peer edits from the relay and unannotated writes interleaved", () => {
    const { text, view, peerText } = bound("abc");
    view.dispatch({ changes: { from: 3, insert: "1" } });
    peerText.insert(0, "P");
    text.insert(0, "N");
    view.dispatch({ changes: { from: view.state.doc.length, insert: "2" } });
    expect(text.toString()).toBe("NPabc12");
    // The y-codemirror.next commands always report success, so undo runs more times than this user has edits.
    for (let i = 0; i < 5; i++) { command("Mod-z")(view); }
    expect(text.toString()).toBe("NPabc");
    expect(view.state.doc.toString()).toBe("NPabc");
    command("Mod-y")(view);
    expect(text.toString()).toContain("NP");
    view.destroy();
  });
});

function editorWithPeer(name: string): EditorView {
  const doc = new Y.Doc();
  const text = doc.getText("content");
  text.insert(0, "hello world");
  const selection = deriveRelativeSelection(text, { anchor: 5, head: 5 });
  const peer: PresenceState = { name, colour: "", file: "main.tex", ...selection };
  const presence = {
    awareness: { on: jest.fn(), off: jest.fn() },
    remote: () => new Map([[7, peer]]),
  } as unknown as PresenceStore;
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
