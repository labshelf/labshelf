// Binds a CodeMirror editor to a shared Y.Text (edits, undo of this user's own edits, selection publishing) and draws the cursors and selections of the other peers.
// CONTRACT: documents/contracts/collaboration.md#device-local-state
import { EditorState, type Extension, RangeSetBuilder } from "@codemirror/state";
import { EditorView, keymap, Decoration, ViewPlugin, WidgetType, type DecorationSet, type KeyBinding, type ViewUpdate } from "@codemirror/view";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";
import { deriveAbsoluteSelection, derivePeerColour, deriveRelativeSelection } from "../cursors.js";
import type { PresenceStore } from "../presence.js";

/** A peer's cursor given as plain data: `anchor` and `head` are offsets in the editor's document. */
export interface PeerCursor {
  name: string;
  colour: string;
  anchor: number;
  head: number;
}

/** Peers given as plain lists, for a host that does not run a presence store. */
export interface PeerCursorSource {
  /** The peers to draw now. */
  peers(): readonly PeerCursor[];
  /** Calls the listener after the peers changed; returns the stop function. */
  subscribe(listener: () => void): () => void;
}

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

function markOf(anchor: number, head: number, length: number, name: string, colour: string): PeerMark {
  const [clampedAnchor, clampedHead] = [Math.min(Math.max(anchor, 0), length), Math.min(Math.max(head, 0), length)];
  return { from: Math.min(clampedAnchor, clampedHead), to: Math.max(clampedAnchor, clampedHead), head: clampedHead, name, colour };
}

function presenceMarks({ text, presence, file }: RemoteCursorsOptions, length: number): PeerMark[] {
  const marks: PeerMark[] = [];
  for (const [clientId, state] of presence.remote()) {
    if (state.file !== file || state.anchor === null || state.head === null) { continue; }
    const selection = deriveAbsoluteSelection(text, { anchor: state.anchor, head: state.head });
    if (!selection) { continue; }
    marks.push(markOf(selection.anchor, selection.head, length, state.name, derivePeerColour(state.colour, clientId)));
  }
  return marks;
}

function listMarks(source: PeerCursorSource, length: number): PeerMark[] {
  // The colour is untrusted input that ends up in editor CSS, so it is kept only when it is one of the palette's.
  return source.peers().map((peer, index) => markOf(peer.anchor, peer.head, length, peer.name, derivePeerColour(peer.colour, index)));
}

function decorationsOf(marks: readonly PeerMark[]): DecorationSet {
  const ranges: { from: number; to: number; decoration: Decoration }[] = [];
  for (const mark of marks) {
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

/** Draws the marks `marksOf` gives and redraws after `watch` calls its listener. */
function cursorExtension(marksOf: (length: number) => PeerMark[], watch: (redraw: () => void) => () => void): Extension {
  const plugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    private readonly stop: () => void;
    constructor(view: EditorView) {
      this.decorations = decorationsOf(marksOf(view.state.doc.length));
      // Redraws on a peer change by an empty transaction, since a plugin cannot set decorations outside an update.
      this.stop = watch(() => view.dispatch({}));
    }
    update(update: ViewUpdate): void { this.decorations = decorationsOf(marksOf(update.view.state.doc.length)); }
    destroy(): void { this.stop(); }
  }, { decorations: (value) => value.decorations });
  return [plugin, caretTheme];
}

export function createRemoteCursors(options: RemoteCursorsOptions): Extension {
  return cursorExtension((length) => presenceMarks(options, length), (redraw) => {
    // TRAP: this user's own presence is set from inside an editor update, where a dispatch throws.
    const onChange = (_changes: unknown, origin: unknown): void => { if (origin !== "local") { redraw(); } };
    options.presence.awareness.on("change", onChange);
    return () => options.presence.awareness.off("change", onChange);
  });
}

/** Draws peers given as plain lists instead of a presence store. */
export function createPeerCursors(source: PeerCursorSource): Extension {
  return cursorExtension((length) => listMarks(source, length), (redraw) => source.subscribe(redraw));
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

export function createCollabExtensions(options: CollabExtensionsOptions): Extension {
  const { text } = options;
  return [
    // INVARIANT: the bound Y.Text holds LF line ends only, so CodeMirror must not split or join on CR.
    EditorState.lineSeparator.of("\n"),
    // Undo of this user's edits only: yCollab tracks the origin of the editor's own edits, and no other origin is tracked, not even
    // the null one Yjs tracks by default, so a peer's edit or a write without an origin is never undone here.
    // Kept over core's TextUndoManager, which groups VS Code change events and treats every origin but its own as remote.
    yCollab(text, null, { undoManager: new Y.UndoManager(text, { trackedOrigins: new Set() }) }),
    // TRAP: from core, y-codemirror.next's KeyBinding resolves to a copy of @codemirror/view that tsc treats as unrelated to ours; the shape is the same.
    keymap.of(yUndoManagerKeymap as unknown as readonly KeyBinding[]),
    publishSelection(options),
    createRemoteCursors(options),
  ];
}
