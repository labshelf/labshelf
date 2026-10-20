/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Undo in an editor bound to a shared text reverts only this user's edits, whatever peers write in between.
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { PresenceHandle } from "@labshelf/core";
import { yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";
import { collabExtensions } from "../../../../../src/library-page/editor/collab/binding";

const presence = {
  awareness: { clientID: 7, on: () => undefined, off: () => undefined, getStates: () => new Map() },
  setLocal: () => undefined,
  remote: () => new Map(),
} as unknown as PresenceHandle;

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
