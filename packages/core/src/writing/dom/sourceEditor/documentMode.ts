// Document mode (D3): the host owns the file's text; the editor starts from it, sends its edits as collab updates and applies the host's.
import { collab, getSyncedVersion, receiveUpdates, sendableUpdates, type Update } from "@codemirror/collab";
import { ChangeSet, Compartment, EditorState, Facet, Transaction, type Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView, type PluginValue, type ViewUpdate } from "@codemirror/view";
import { listChanges, type SourceUpdate } from "../../sourceEditor/authority.js";
import { fromDisk } from "./openEditors.js";

export interface SourceDocument {
  text: string; lineBreak: "\n" | "\r\n"; version: number; dirty: boolean;
  /** Sends the editor's unconfirmed updates made on top of `version`. */
  push(version: number, updates: SourceUpdate[]): void;
  /** Host updates and confirmations of the editor's own; `resync` replaces the text. */
  subscribe(listener: { updates(version: number, updates: SourceUpdate[]): void; resync(text: string, version: number): void; dirty(dirty: boolean): void }): () => void;
  save(): void;
}

/** Runs when the host reports the document dirty or clean. */
export const documentDirty = Facet.define<(dirty: boolean) => void>();

/** What the editor asks of its document connection. */
export interface DocumentSync {
  /** Sends pending edits now and resolves true once the host has confirmed every one. */
  flush(): Promise<boolean>;
  /** Sends pending edits, then asks the host to save. */
  save(): void;
  /** Sends pending edits now when no push is in flight, without waiting for the host. */
  sendNow(): void;
}

const scheduleFrame = (run: () => void): (() => void) => {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(run);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(run, 16);
  return () => clearTimeout(id);
};

/** The cursor at the same line and column of the new text; the end of the text when that line is gone. */
function sameLineColumn(state: EditorState, text: string): number {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const column = head - line.from;
  const next = EditorState.create({ doc: text }).doc;
  if (line.number > next.lines) return next.length;
  const target = next.line(line.number);
  return target.from + Math.min(column, target.length);
}

class DocumentConnection implements PluginValue, DocumentSync {
  /** How many of the oldest unconfirmed updates the host has been sent and not yet confirmed; nothing more is pushed until it is 0. */
  private inFlight = 0;
  private cancelFrame: (() => void) | undefined;
  private resyncing = false;
  private saveAfterPush = false;
  private waiters: Array<(clean: boolean) => void> = [];
  private readonly unsubscribe: () => void;

  constructor(private readonly view: EditorView, private readonly document: SourceDocument, private readonly sync: Compartment, private readonly clientID: string) {
    this.unsubscribe = document.subscribe({
      updates: (version, updates) => this.receive(version, updates),
      resync: (text, version) => this.resync(text, version),
      dirty: (dirty) => this.reportDirty(dirty),
    });
    if (document.dirty) this.reportDirty(true);
  }

  update(update: ViewUpdate): void {
    if (!this.resyncing && update.docChanged) this.schedule();
  }

  destroy(): void {
    this.cancelFrame?.();
    this.cancelFrame = undefined;
    this.unsubscribe();
    this.settle(true);
  }

  flush(): Promise<boolean> {
    this.sendNow();
    if (this.pending().length === 0) return Promise.resolve(true);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  save(): void {
    this.sendNow();
    this.document.save();
    // INVARIANT: edits made while a push is in flight go out after it, so the host is asked to save again once they do.
    if (this.pending().length > this.inFlight) this.saveAfterPush = true;
  }

  sendNow(): void {
    this.cancelFrame?.();
    this.cancelFrame = undefined;
    if (this.inFlight > 0 || this.resyncing) return;
    const updates = this.pending();
    if (updates.length === 0) return;
    this.inFlight = updates.length;
    this.document.push(getSyncedVersion(this.view.state), updates.map((update) => ({ clientID: this.clientID, changes: listChanges(update.changes) })));
    if (this.saveAfterPush) {
      this.saveAfterPush = false;
      this.document.save();
    }
  }

  private pending(): readonly Update[] {
    return sendableUpdates(this.view.state);
  }

  /** One push per animation frame, and none while the host has not confirmed the previous one. */
  private schedule(): void {
    if (this.cancelFrame || this.inFlight > 0 || this.pending().length === 0) return;
    this.cancelFrame = scheduleFrame(() => { this.cancelFrame = undefined; this.sendNow(); });
  }

  /** `version` is the host's version after `updates`; updates the editor already has are skipped. */
  private receive(version: number, updates: SourceUpdate[]): void {
    const synced = getSyncedVersion(this.view.state);
    const start = version - updates.length;
    // A gap means updates were missed; the host resyncs the editor then.
    if (version <= synced || start > synced) return;
    const pending = this.pending();
    let length = pending.length > 0 ? pending[0]!.changes.length : this.view.state.doc.length;
    const fresh = updates.slice(synced - start).map((update) => {
      const changes = ChangeSet.of(update.changes, length);
      length = changes.newLength;
      return { clientID: update.clientID, changes };
    });
    const before = pending.length;
    this.view.dispatch(receiveUpdates(this.view.state, fresh));
    this.inFlight = Math.max(0, this.inFlight - (before - this.pending().length));
    this.afterSync();
  }

  private resync(text: string, version: number): void {
    const anchor = sameLineColumn(this.view.state, text);
    this.cancelFrame?.();
    this.cancelFrame = undefined;
    this.resyncing = true;
    try {
      // The collab state starts afresh at the host's version: the field leaves with the old text, then comes back on the new one.
      this.view.dispatch({
        changes: { from: 0, to: this.view.state.doc.length, insert: text },
        selection: { anchor },
        effects: this.sync.reconfigure([]),
        annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true), fromDisk.of(true)],
      });
      this.view.dispatch({ effects: this.sync.reconfigure(collab({ startVersion: version, clientID: this.clientID })) });
    } finally {
      this.resyncing = false;
    }
    this.inFlight = 0;
    this.afterSync();
  }

  private afterSync(): void {
    if (this.pending().length === 0) this.settle(true);
    else this.schedule();
  }

  private settle(clean: boolean): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve(clean);
  }

  private reportDirty(dirty: boolean): void {
    for (const listener of this.view.state.facet(documentDirty)) listener(dirty);
  }
}

const connections = new WeakMap<EditorView, DocumentConnection>();

/** The document connection of an editor mounted with createDocumentExtensions; undefined for any other editor. */
export function documentSync(view: EditorView): DocumentSync | undefined {
  return connections.get(view);
}

export function createDocumentExtensions(document: SourceDocument, clientID: string): Extension[] {
  const sync = new Compartment();
  const plugin = ViewPlugin.define((view) => {
    const connection = new DocumentConnection(view, document, sync, clientID);
    connections.set(view, connection);
    return connection;
  });
  return [
    sync.of(collab({ startVersion: document.version, clientID })),
    // Host updates arrive as remote collab transactions: they stay out of the undo history and are no edit to save.
    EditorState.transactionExtender.of((tr) => (tr.annotation(Transaction.remote) && !tr.annotation(fromDisk) ? { annotations: fromDisk.of(true) } : null)),
    plugin,
  ];
}
