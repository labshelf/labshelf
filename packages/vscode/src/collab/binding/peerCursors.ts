// Draws other collaborators' cursors and selections in an editor, each in their colour with their name on hover.
import * as vscode from "vscode";

/** Offsets are document offsets; `colour` comes from core's `peerColour`, which only returns palette values. */
export interface PeerCursor {
  clientId: number;
  name: string;
  colour: string;
  anchor: number;
  head: number;
}

interface PeerDecorations {
  colour: string;
  selection: vscode.TextEditorDecorationType;
  caret: vscode.TextEditorDecorationType;
}

function createDecorations(colour: string): PeerDecorations {
  return {
    colour,
    selection: vscode.window.createTextEditorDecorationType({
      backgroundColor: `color-mix(in srgb, ${colour} 25%, transparent)`,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    }),
    caret: vscode.window.createTextEditorDecorationType({
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      // PLATFORM: an attachment takes no border-left option, so the caret bar rides on its CSS text decoration.
      before: { contentText: "​", textDecoration: `none; border-left: 2px solid ${colour}; margin: 0 -1px` },
    }),
  };
}

/** The caret covers the character after it when there is one, as an empty range shows no hover. */
function caretRange(document: vscode.TextDocument, head: vscode.Position): vscode.Range {
  const lineEnd = document.lineAt(head.line).range.end;
  return new vscode.Range(head, head.isEqual(lineEnd) ? head : head.translate(0, 1));
}

export class PeerCursors implements vscode.Disposable {
  private readonly decorations = new Map<number, PeerDecorations>();

  /** Shows exactly `peers` in `editor`: a known peer missing from the list is cleared there. */
  renderPeerCursors(editor: vscode.TextEditor, peers: readonly PeerCursor[]): void {
    const { document } = editor;
    const shown = new Set<number>();
    for (const peer of peers) {
      shown.add(peer.clientId);
      const decorations = this.decorationsFor(peer);
      const hoverMessage = new vscode.MarkdownString().appendText(peer.name);
      const start = document.positionAt(Math.min(peer.anchor, peer.head));
      const end = document.positionAt(Math.max(peer.anchor, peer.head));
      editor.setDecorations(decorations.selection, start.isEqual(end) ? [] : [{ range: new vscode.Range(start, end), hoverMessage }]);
      editor.setDecorations(decorations.caret, [{ range: caretRange(document, document.positionAt(peer.head)), hoverMessage }]);
    }
    for (const [clientId, decorations] of this.decorations) {
      if (shown.has(clientId)) { continue; }
      editor.setDecorations(decorations.selection, []);
      editor.setDecorations(decorations.caret, []);
    }
  }

  /** Clears a peer that left from every editor. */
  removePeer(clientId: number): void {
    const decorations = this.decorations.get(clientId);
    if (!decorations) { return; }
    decorations.selection.dispose();
    decorations.caret.dispose();
    this.decorations.delete(clientId);
  }

  dispose(): void {
    [...this.decorations.keys()].forEach((clientId) => this.removePeer(clientId));
  }

  private decorationsFor(peer: PeerCursor): PeerDecorations {
    const known = this.decorations.get(peer.clientId);
    if (known?.colour === peer.colour) { return known; }
    this.removePeer(peer.clientId);
    const created = createDecorations(peer.colour);
    this.decorations.set(peer.clientId, created);
    return created;
  }
}
