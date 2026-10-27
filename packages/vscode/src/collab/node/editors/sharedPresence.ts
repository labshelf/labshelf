// Shares this user's cursor in shared files with the peers, and draws theirs in the visible editors of the same file.
import * as vscode from "vscode";

import { readFileText, derivePeerColour, deriveAbsoluteSelection, deriveRelativeSelection, type PresenceState, type ShareConnection } from "@labshelf/core";
import { PeerCursors, type PeerCursor } from "../../binding/index.js";
import type { SharedEditors } from "./sharedEditors.js";
import { disposeAll } from "../../../disposables/index.js";

const PUBLISH_DELAY_MS = 100;

export class SharedPresence implements vscode.Disposable {
  private readonly cursors = new PeerCursors();
  private readonly pending = new Map<ShareConnection, ReturnType<typeof setTimeout>>();
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly editors: SharedEditors, private readonly shares: () => readonly ShareConnection[], private readonly userName: string) {
    const publishOf = (document: vscode.TextDocument) => { const shared = editors.of(document); if (shared) { this.schedule(shared.share); } };
    this.subscriptions = [
      vscode.window.onDidChangeTextEditorSelection(({ textEditor }) => publishOf(textEditor.document)),
      vscode.window.onDidChangeActiveTextEditor(() => this.shares().forEach((share) => this.schedule(share))),
      vscode.window.onDidChangeVisibleTextEditors(() => this.renderAll()),
      // A local edit moves the absolute offsets the peers' relative positions resolve to.
      vscode.workspace.onDidChangeTextDocument(({ document }) => { const shared = editors.of(document); if (shared) { this.render(shared.share); } }),
      editors.onDidChange(() => { this.renderAll(); this.shares().forEach((share) => this.schedule(share)); }),
    ];
  }

  /** Publishes this user's presence in the share and draws its peers until disposed. */
  watch(share: ShareConnection): vscode.Disposable {
    const { awareness } = share.presence;
    const onChange = ({ removed }: { removed: number[] }) => {
      removed.forEach((clientId) => this.cursors.removePeer(clientId));
      this.render(share);
    };
    awareness.on("change", onChange);
    this.schedule(share);
    return {
      dispose: () => {
        awareness.off("change", onChange);
        clearTimeout(this.pending.get(share));
        this.pending.delete(share);
        share.presence.remote().forEach((_state, clientId) => this.cursors.removePeer(clientId));
      },
    };
  }

  dispose(): void {
    this.pending.forEach((timer) => clearTimeout(timer));
    disposeAll(this.subscriptions);
    this.cursors.dispose();
  }

  private schedule(share: ShareConnection): void {
    if (this.pending.has(share)) { return; }
    this.pending.set(share, setTimeout(() => { this.pending.delete(share); this.publish(share); }, PUBLISH_DELAY_MS));
  }

  private publish(share: ShareConnection): void {
    const { presence } = share;
    const base = { name: this.userName, colour: derivePeerColour("", presence.awareness.clientID) };
    const editor = vscode.window.activeTextEditor;
    const shared = editor && this.editors.of(editor.document);
    if (!editor || shared?.share !== share) {
      presence.setLocal({ ...base, file: null, anchor: null, head: null });
      return;
    }
    const { document, selection } = editor;
    const { text } = shared.binding;
    const relative = deriveRelativeSelection(readFileText(share.session.openDoc(shared.path)), {
      anchor: text.toNormalizedOffset(document.offsetAt(selection.anchor)),
      head: text.toNormalizedOffset(document.offsetAt(selection.active)),
    });
    presence.setLocal({ ...base, file: shared.path, ...relative });
  }

  private renderAll(): void {
    this.shares().forEach((share) => this.render(share));
  }

  private render(share: ShareConnection): void {
    const remote = share.presence.remote();
    for (const editor of vscode.window.visibleTextEditors) {
      const shared = this.editors.of(editor.document);
      if (shared?.share !== share) { continue; }
      this.cursors.renderPeerCursors(editor, peerCursorsIn(share, shared.path, shared.binding.text, remote));
    }
  }
}

function peerCursorsIn(
  share: ShareConnection, file: string, text: { toDocumentOffset(offset: number): number }, remote: Map<number, PresenceState>,
): PeerCursor[] {
  const yText = readFileText(share.session.openDoc(file));
  const cursors: PeerCursor[] = [];
  remote.forEach((state, clientId) => {
    if (state.file !== file || state.anchor === null || state.head === null) { return; }
    const selection = deriveAbsoluteSelection(yText, { anchor: state.anchor, head: state.head });
    if (!selection) { return; }
    cursors.push({
      clientId, name: state.name, colour: derivePeerColour(state.colour, clientId),
      anchor: text.toDocumentOffset(selection.anchor), head: text.toDocumentOffset(selection.head),
    });
  });
  return cursors;
}
