// Binds every open document of a connected share's text files to its shared text, lets the mirror sync it again on close, and shares this user's cursor with the peers while drawing theirs.
import * as path from "node:path";
import * as vscode from "vscode";

import {
  deriveAbsoluteSelection,
  derivePeerColour,
  deriveRelativeSelection,
  isInside,
  readFileText,
  readShareIndexDocFiles,
  type ILogger,
  type PresenceState,
  type ShareConnection,
} from "@labshelf/core";
import { nodePathOps } from "@labshelf/core/node";
import { attachDocument, PeerCursors, registerUndoRedo, RemoteUpdateQueue, type DocumentBinding, type PeerCursor } from "../binding.js";
import { disposeAll } from "../../disposables/index.js";
import { provideSourcePresence, type PeerSelection, type SourcePresencePort } from "../../writing/sourceEditor/index.js";

export interface SharedDocument {
  share: ShareConnection;
  /** POSIX path relative to the project folder. */
  path: string;
  binding: DocumentBinding;
}

/** The file's POSIX path inside the folder, or undefined outside it. */
function relativePath(folder: string, document: vscode.TextDocument): string | undefined {
  if (document.uri.scheme !== "file") { return undefined; }
  if (!isInside(nodePathOps, folder, document.uri.fsPath)) { return undefined; }
  return path.relative(folder, document.uri.fsPath).split(path.sep).join("/");
}

export class SharedEditors implements vscode.Disposable {
  private readonly bound = new Map<string, SharedDocument>();
  private readonly queue: RemoteUpdateQueue;
  private readonly undoRedo;
  private readonly subscriptions: vscode.Disposable[];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Fires after a document was bound or unbound. */
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly shares: () => readonly ShareConnection[], private readonly logger: ILogger) {
    this.queue = new RemoteUpdateQueue(logger);
    this.undoRedo = registerUndoRedo((document) => this.bound.get(document.uri.toString())?.binding, logger);
    this.subscriptions = [
      vscode.workspace.onDidOpenTextDocument((document) => this.shares().forEach((share) => this.bind(share, document))),
      vscode.workspace.onDidCloseTextDocument((document) => this.release(document.uri.toString(), true)),
    ];
  }

  of(document: vscode.TextDocument): SharedDocument | undefined {
    return this.bound.get(document.uri.toString());
  }

  /** True while an open document holds the file, so the mirror leaves it to the binding. */
  isOwned(folder: string, file: string): boolean {
    return [...this.bound.values()].some((entry) => entry.share.folder === folder && entry.path === file);
  }

  /** Binds the share's open documents now and whenever the index lists another text file. */
  attach(share: ShareConnection): vscode.Disposable {
    const bindOpen = () => vscode.workspace.textDocuments.forEach((document) => this.bind(share, document));
    const files = readShareIndexDocFiles(share.session.index);
    files.observe(bindOpen);
    bindOpen();
    return {
      dispose: () => {
        files.unobserve(bindOpen);
        // The share is closing, so the mirror that would take the files back closes too.
        [...this.bound].filter(([, entry]) => entry.share === share).forEach(([key]) => this.release(key, false));
      },
    };
  }

  dispose(): void {
    [...this.bound.keys()].forEach((key) => this.release(key, false));
    disposeAll(this.subscriptions);
    this.undoRedo.dispose();
    this.changeEmitter.dispose();
  }

  private bind(share: ShareConnection, document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const file = relativePath(share.folder, document);
    if (this.bound.has(key) || document.isClosed || !file || readShareIndexDocFiles(share.session.index).get(file)?.kind !== "text") { return; }
    try {
      const binding = attachDocument(document, readFileText(share.session.openDoc(file)), { queue: this.queue, logger: this.logger });
      this.bound.set(key, { share, path: file, binding });
      void this.logger.log("INFO", "collab", "Bound an editor to a shared file", { shareId: share.shareId, path: file });
    } catch (error) {
      void this.logger.error("collab", error, { action: "bind an editor", shareId: share.shareId, path: file });
      return;
    }
    this.changed();
  }

  private release(key: string, giveBack: boolean): void {
    const entry = this.bound.get(key);
    if (!entry) { return; }
    this.bound.delete(key);
    entry.binding.dispose();
    if (giveBack) { entry.share.mirror?.changed(entry.path); }
    this.changed();
  }

  private changed(): void {
    this.undoRedo.refreshContext();
    this.changeEmitter.fire();
  }
}

const PUBLISH_DELAY_MS = 100;

interface PeerSubscription { uri: vscode.Uri; listener: (peers: PeerSelection[]) => void }

export class SharedPresence implements vscode.Disposable, SourcePresencePort {
  private readonly cursors = new PeerCursors();
  private readonly pending = new Map<ShareConnection, ReturnType<typeof setTimeout>>();
  private readonly subscriptions: vscode.Disposable[];
  private readonly peerSubscriptions = new Set<PeerSubscription>();
  /** The selection a LabShelf editor reported, standing for the active text editor's until a text editor is active again. */
  private sourceSelection: { uri: vscode.Uri; anchor: number; head: number } | undefined;

  constructor(private readonly editors: SharedEditors, private readonly shares: () => readonly ShareConnection[], private readonly userName: string) {
    const publishOf = (document: vscode.TextDocument) => { const shared = editors.of(document); if (shared) { this.schedule(shared.share); } };
    this.subscriptions = [
      vscode.window.onDidChangeTextEditorSelection(({ textEditor }) => publishOf(textEditor.document)),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) { this.sourceSelection = undefined; }
        this.shares().forEach((share) => this.schedule(share));
      }),
      vscode.window.onDidChangeVisibleTextEditors(() => this.renderAll()),
      // A local edit moves the absolute offsets the peers' relative positions resolve to.
      vscode.workspace.onDidChangeTextDocument(({ document }) => { const shared = editors.of(document); if (shared) { this.render(shared.share); } }),
      editors.onDidChange(() => { this.renderAll(); this.shares().forEach((share) => this.schedule(share)); }),
    ];
    provideSourcePresence(this);
  }

  /** Publishes the selection of a LabShelf editor on the file, as a text editor's selection on it would be; offsets are the document's. */
  publishSelection(uri: vscode.Uri, selection: { anchor: number; head: number }): void {
    this.sourceSelection = { uri, ...selection };
    const shared = this.sharedAt(uri);
    if (shared) { this.schedule(shared.share); }
  }

  /** Drops the selection a LabShelf editor published on the file, as when its panel closes. */
  dropSelection(uri: vscode.Uri): void {
    if (this.sourceSelection?.uri.toString() !== uri.toString()) { return; }
    this.sourceSelection = undefined;
    this.shares().forEach((share) => this.schedule(share));
  }

  /** Calls the listener now and after each change with the peers on the file, their offsets the document's. */
  peersOf(uri: vscode.Uri, listener: (peers: PeerSelection[]) => void): () => void {
    const subscription: PeerSubscription = { uri, listener };
    this.peerSubscriptions.add(subscription);
    listener(this.peersAt(uri));
    return () => { this.peerSubscriptions.delete(subscription); };
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
    provideSourcePresence(undefined);
    this.pending.forEach((timer) => clearTimeout(timer));
    this.peerSubscriptions.clear();
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
    const current = this.currentSelection();
    const shared = current && this.sharedAt(current.uri);
    if (!current || shared?.share !== share) {
      presence.setLocal({ ...base, file: null, anchor: null, head: null });
      return;
    }
    const { text } = shared.binding;
    const relative = deriveRelativeSelection(readFileText(share.session.openDoc(shared.path)), {
      anchor: text.toNormalizedOffset(current.anchor),
      head: text.toNormalizedOffset(current.head),
    });
    presence.setLocal({ ...base, file: shared.path, ...relative });
  }

  /** The selection in focus: the active text editor's, or else the LabShelf editor's last one; offsets the document's. */
  private currentSelection(): { uri: vscode.Uri; anchor: number; head: number } | undefined {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const { document, selection } = editor;
      return { uri: document.uri, anchor: document.offsetAt(selection.anchor), head: document.offsetAt(selection.active) };
    }
    return this.sourceSelection;
  }

  private sharedAt(uri: vscode.Uri): SharedDocument | undefined {
    const key = uri.toString();
    const document = vscode.workspace.textDocuments.find((open) => open.uri.toString() === key);
    return document && this.editors.of(document);
  }

  private peersAt(uri: vscode.Uri): PeerSelection[] {
    const shared = this.sharedAt(uri);
    if (!shared) { return []; }
    return peerCursorsIn(shared.share, shared.path, shared.binding.text, shared.share.presence.remote())
      .map(({ name, colour, anchor, head }) => ({ name, colour, anchor, head }));
  }

  private notifyPeers(share: ShareConnection): void {
    for (const { uri, listener } of this.peerSubscriptions) {
      if (this.sharedAt(uri)?.share === share) { listener(this.peersAt(uri)); }
    }
  }

  private renderAll(): void {
    this.shares().forEach((share) => this.render(share));
  }

  private render(share: ShareConnection): void {
    this.notifyPeers(share);
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
