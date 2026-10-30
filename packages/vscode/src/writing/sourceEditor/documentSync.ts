// Keeps a TextDocument and the source authority in step for one LabShelf editor panel: client pushes become WorkspaceEdits, their echoes are swallowed, outside edits reach every panel on the same authority as host updates, and save and dirty follow the document.
import * as vscode from "vscode";
import type { ILogger, SourceAuthority, SourceTextChange, SourceUpdate } from "@labshelf/core";

type Change = SourceTextChange;
type Update = SourceUpdate;
type Authority = SourceAuthority;
/** A webview message either way; the provider parses inbound ones before they reach the sync. */
type Message = { type: string; [key: string]: unknown };

interface DocumentSyncDeps {
  document: vscode.TextDocument;
  authority: Authority;
  applyEdit(edit: vscode.WorkspaceEdit): Thenable<boolean>;
  post(message: Message): void;
  logger: ILogger;
}

interface Member { post(message: Message): void }

/** State shared by every sync on one authority: the panels, the edits in flight and the document listeners. */
interface Shared {
  document: vscode.TextDocument;
  authority: Authority;
  logger: ILogger;
  members: Set<Member>;
  expected: Change[][];
  listeners: vscode.Disposable[];
}

const sharedByAuthority = new WeakMap<Authority, Shared>();

const byPosition = (a: Change, b: Change): number => a.from - b.from || a.to - b.to;

function sameChanges(a: readonly Change[], b: readonly Change[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort(byPosition);
  const right = [...b].sort(byPosition);
  return left.every((change, i) => change.from === right[i]!.from && change.to === right[i]!.to && change.insert === right[i]!.insert);
}

function broadcast(shared: Shared, message: Message): void {
  for (const member of shared.members) member.post(message);
}

function postDirty(shared: Shared): void {
  broadcast(shared, { type: "dirty", dirty: shared.document.isDirty });
}

function resyncMessage(text: string, version: number): Message {
  return { type: "resync", text, version };
}

/** Sends every panel the updates the authority accepted after `from`; a version outside the kept history resyncs them instead. */
function broadcastSince(shared: Shared, from: number): void {
  const { authority } = shared;
  try {
    const updates = authority.since(from);
    if (updates.length > 0) broadcast(shared, { type: "updates", version: authority.version, updates });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    broadcast(shared, resyncMessage(authority.text(), authority.version));
  }
}

function onDocumentChange(shared: Shared, event: vscode.TextDocumentChangeEvent): void {
  if (event.document.uri.toString() !== shared.document.uri.toString()) return;
  if (event.contentChanges.length === 0) return;
  const changes: Change[] = event.contentChanges
    .map((c) => ({ from: c.rangeOffset, to: c.rangeOffset + c.rangeLength, insert: c.text }))
    .sort(byPosition);
  const index = shared.expected.findIndex((expected) => sameChanges(expected, changes));
  if (index >= 0) {
    shared.expected.splice(index, 1);
  } else {
    const before = shared.authority.version;
    shared.authority.external(changes);
    broadcastSince(shared, before);
  }
  postDirty(shared);
}

function joinShared(deps: DocumentSyncDeps, member: Member): Shared {
  let shared = sharedByAuthority.get(deps.authority);
  if (!shared) {
    const created: Shared = {
      document: deps.document,
      authority: deps.authority,
      logger: deps.logger,
      members: new Set(),
      expected: [],
      listeners: [],
    };
    created.listeners.push(
      vscode.workspace.onDidChangeTextDocument((event) => onDocumentChange(created, event)),
      vscode.workspace.onDidSaveTextDocument((saved) => {
        if (saved.uri.toString() === created.document.uri.toString()) postDirty(created);
      }),
    );
    sharedByAuthority.set(deps.authority, created);
    shared = created;
  }
  shared.members.add(member);
  return shared;
}

function leaveShared(shared: Shared, member: Member): void {
  shared.members.delete(member);
  if (shared.members.size > 0) return;
  for (const listener of shared.listeners) listener.dispose();
  shared.listeners = [];
  sharedByAuthority.delete(shared.authority);
}

function toWorkspaceEdit(document: vscode.TextDocument, changes: readonly Change[]): vscode.WorkspaceEdit {
  const edit = new vscode.WorkspaceEdit();
  for (const change of changes) {
    edit.replace(document.uri, new vscode.Range(document.positionAt(change.from), document.positionAt(change.to)), change.insert);
  }
  return edit;
}

/** Applies each accepted batch to the document in turn; a rejected edit sends the member the document's own text and stops. */
async function applyAccepted(deps: DocumentSyncDeps, shared: Shared, member: Member, accepted: readonly Change[][]): Promise<void> {
  const { document, authority, logger } = deps;
  for (const changes of accepted) {
    if (changes.length === 0) continue;
    shared.expected.push(changes);
    let applied = false;
    try {
      applied = await deps.applyEdit(toWorkspaceEdit(document, changes));
    } catch (error) {
      void logger.log("ERROR", "sourceEditor", "applyEdit failed", { error: String(error) });
    }
    // The echo is normally swallowed during applyEdit; drop the expectation if it never came.
    const index = shared.expected.indexOf(changes);
    if (index >= 0) shared.expected.splice(index, 1);
    if (!applied) {
      member.post(resyncMessage(document.getText(), authority.version));
      return;
    }
  }
}

async function pushUpdates(deps: DocumentSyncDeps, shared: Shared, member: Member, message: Message): Promise<void> {
  const { authority } = deps;
  const version = message["version"];
  const updates = message["updates"];
  if (typeof version !== "number" || !Array.isArray(updates)) return;
  const before = authority.version;
  const accepted = authority.receive(version, updates as Update[]);
  if (!accepted) {
    member.post(resyncMessage(authority.text(), authority.version));
    return;
  }
  broadcastSince(shared, before);
  await applyAccepted(deps, shared, member, accepted);
  postDirty(shared);
}

export function createDocumentSync(deps: DocumentSyncDeps): { receive(message: Message): Promise<void>; dispose(): void } {
  let disposed = false;
  const member: Member = { post: (message) => { if (!disposed) deps.post(message); } };
  const shared = joinShared(deps, member);
  const { document, logger } = deps;

  return {
    async receive(message) {
      if (disposed) return;
      try {
        if (message.type === "push") await pushUpdates(deps, shared, member, message);
        else if (message.type === "save") await document.save();
      } catch (error) {
        void logger.log("ERROR", "sourceEditor", `handling ${message.type} failed`, { error: String(error) });
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      leaveShared(shared, member);
    },
  };
}
