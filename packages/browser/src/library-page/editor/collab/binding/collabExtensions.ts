// Binds a CodeMirror editor to a shared file's Y.Text: edits both ways, own-only undo, and this user's and peers' selections.
// CONTRACT: documents/contracts/collaboration.md
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { peerColour, toRelativeSelection, type PresenceHandle } from "@labshelf/core";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";
import { remoteCursors } from "./remoteCursors";

export interface CollabExtensionsOptions {
  text: Y.Text;
  presence: PresenceHandle;
  /** POSIX path of the file in the project, as peers name it in their presence. */
  file: string;
  /** This user's name shown on their cursor to peers. */
  name: string;
}

/** Publishes this user's selection whenever it or the document changes. */
function publishSelection({ text, presence, file, name }: CollabExtensionsOptions): Extension {
  const colour = peerColour("", presence.awareness.clientID);
  const publish = (view: EditorView): void => {
    const { anchor, head } = view.state.selection.main;
    presence.setLocal({ name, colour, file, ...toRelativeSelection(text, { anchor, head }) });
  };
  return [
    EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.docChanged || update.focusChanged) { publish(update.view); }
    }),
  ];
}

export function collabExtensions(options: CollabExtensionsOptions): Extension {
  const { text } = options;
  return [
    // INVARIANT: the bound Y.Text holds LF line ends only, so CodeMirror must not split or join on CR.
    EditorState.lineSeparator.of("\n"),
    // Undo of this user's edits only: peers' edits are never undone here.
    yCollab(text, null, { undoManager: new Y.UndoManager(text) }),
    keymap.of(yUndoManagerKeymap),
    publishSelection(options),
    remoteCursors(options),
  ];
}
