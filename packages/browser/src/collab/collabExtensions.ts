// Binds a CodeMirror editor to a shared file's Y.Text: edits both ways, own-only undo, and this user's and peers' selections.
// CONTRACT: documents/contracts/collaboration.md
import { EditorState, type Extension, RangeSetBuilder } from "@codemirror/state";
import {
  EditorView,
  keymap,
  Decoration,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  derivePeerColour,
  deriveRelativeSelection,
  type PresenceStore,
  deriveAbsoluteSelection,
} from "@labshelf/core";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";

interface RemoteCursorsOptions {
  text: Y.Text;
  presence: PresenceStore;
  file: string;
}

class PeerCaret extends WidgetType {
  constructor(readonly name: string, readonly colour: string) { super(); }
  override eq(other: PeerCaret): boolean { return other.name === this.name && other.colour === this.colour; }
  toDOM(): HTMLElement {
    const caret = document.createElement("span");
    caret.className = "ls-peer-caret";
    caret.dataset.peerName = this.name;
    caret.title = this.name;
    caret.setAttribute("aria-label", this.name);
    caret.style.borderLeftColor = this.colour;
    const label = document.createElement("span");
    label.className = "ls-peer-caret-label";
    // The caret's aria-label already names the peer.
    label.setAttribute("aria-hidden", "true");
    label.textContent = this.name;
    label.style.backgroundColor = this.colour;
    caret.append(label);
    return caret;
  }
}

interface PeerMark { from: number; to: number; head: number; name: string; colour: string }

function peerMarks({ text, presence, file }: RemoteCursorsOptions, length: number): PeerMark[] {
  const marks: PeerMark[] = [];
  for (const [clientId, state] of presence.remote()) {
    if (state.file !== file || state.anchor === null || state.head === null) { continue; }
    const selection = deriveAbsoluteSelection(text, { anchor: state.anchor, head: state.head });
    if (!selection) { continue; }
    const [anchor, head] = [Math.min(selection.anchor, length), Math.min(selection.head, length)];
    marks.push({ from: Math.min(anchor, head), to: Math.max(anchor, head), head, name: state.name, colour: derivePeerColour(state.colour, clientId) });
  }
  return marks;
}

function decorationsOf(options: RemoteCursorsOptions, view: EditorView): DecorationSet {
  const ranges: { from: number; to: number; decoration: Decoration }[] = [];
  for (const mark of peerMarks(options, view.state.doc.length)) {
    if (mark.from < mark.to) {
      const attributes = { style: `background-color: color-mix(in srgb, ${mark.colour} 30%, transparent)` };
      ranges.push({ from: mark.from, to: mark.to, decoration: Decoration.mark({ class: "ls-peer-selection", attributes }) });
    }
    ranges.push({ from: mark.head, to: mark.head, decoration: Decoration.widget({ widget: new PeerCaret(mark.name, mark.colour), side: 1 }) });
  }
  ranges.sort((a, b) => a.from - b.from || a.decoration.startSide - b.decoration.startSide);
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) { builder.add(range.from, range.to, range.decoration); }
  return builder.finish();
}

const caretTheme = EditorView.baseTheme({
  ".ls-peer-caret": { position: "relative", borderLeft: "2px solid", marginLeft: "-1px", marginRight: "-1px" },
  ".ls-peer-caret-label": {
    position: "absolute", bottom: "100%", left: "calc(-1 * var(--ls-space-1))", zIndex: "1", pointerEvents: "none", userSelect: "none", whiteSpace: "nowrap",
    padding: "0 var(--ls-space-1)", borderRadius: "var(--ls-radius-sm)",
    color: "var(--ls-button-fg)", font: "var(--ls-text-xs) var(--ls-font)", lineHeight: "normal",
  },
});

export function remoteCursors(options: RemoteCursorsOptions): Extension {
  const plugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    private readonly stop: () => void;
    constructor(view: EditorView) {
      this.decorations = decorationsOf(options, view);
      // Redraws on a peer's presence change by an empty transaction, since a plugin cannot set decorations outside an update.
      // TRAP: this user's own presence is set from inside an editor update, where a dispatch throws.
      const redraw = (_changes: unknown, origin: unknown): void => { if (origin !== "local") { view.dispatch({}); } };
      options.presence.awareness.on("change", redraw);
      this.stop = () => options.presence.awareness.off("change", redraw);
    }
    update(update: ViewUpdate): void { this.decorations = decorationsOf(options, update.view); }
    destroy(): void { this.stop(); }
  }, { decorations: (value) => value.decorations });
  return [plugin, caretTheme];
}

export interface CollabExtensionsOptions {
  text: Y.Text;
  presence: PresenceStore;
  /** POSIX path of the file in the project, as peers name it in their presence. */
  file: string;
  /** This user's name shown on their cursor to peers. */
  name: string;
}

/** Publishes this user's selection whenever it or the document changes. */
function publishSelection({ text, presence, file, name }: CollabExtensionsOptions): Extension {
  const colour = derivePeerColour("", presence.awareness.clientID);
  const publish = (view: EditorView): void => {
    const { anchor, head } = view.state.selection.main;
    presence.setLocal({ name, colour, file, ...deriveRelativeSelection(text, { anchor, head }) });
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
    // Undo of this user's edits only: yCollab tracks the origin of the editor's own edits, and no other origin is tracked, not even
    // the null one Yjs tracks by default, so a peer's edit or a write without an origin is never undone here.
    // Kept over core's TextUndoManager, which groups VS Code change events and treats every origin but its own as remote.
    yCollab(text, null, { undoManager: new Y.UndoManager(text, { trackedOrigins: new Set() }) }),
    keymap.of(yUndoManagerKeymap),
    publishSelection(options),
    remoteCursors(options),
  ];
}
