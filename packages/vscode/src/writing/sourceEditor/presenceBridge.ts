// Presence for the LabShelf editor: the webview's selection is published like a native editor's, and the peers on the file are posted back, with offsets converted between the webview's LF text and the document's own line break.
import type * as vscode from "vscode";

export interface PeerSelection { name: string; colour: string; anchor: number; head: number }

/** What the LabShelf editor asks of the shared presence for its file; document offsets on both sides. */
export interface SourcePresencePort {
  publishSelection(uri: vscode.Uri, selection: { anchor: number; head: number }): void;
  /** Drops the selection a LabShelf editor published on the file; the published presence falls back to the active text editor's, or to none. */
  dropSelection(uri: vscode.Uri): void;
  /** The listener runs at once with the file's current peers and after each change; returns the stop function. */
  peersOf(uri: vscode.Uri, listener: (peers: PeerSelection[]) => void): () => void;
}

let sourcePresence: SourcePresencePort | undefined;

/** Set while collaboration runs (desktop) and cleared when it stops; the LabShelf editor reads it when a panel opens. */
export function provideSourcePresence(port: SourcePresencePort | undefined): void { sourcePresence = port; }

export function currentSourcePresence(): SourcePresencePort | undefined { return sourcePresence; }

// vscode.EndOfLine.CRLF; the enum is not imported so the bridge stays free of the vscode runtime.
const CRLF = 2;

/** The document offsets of the "\r" of every "\r\n" in the text, ascending. */
function crlfStarts(text: string): number[] {
  const starts: number[] = [];
  for (let at = text.indexOf("\r\n"); at !== -1; at = text.indexOf("\r\n", at + 2)) { starts.push(at); }
  return starts;
}

/** The offset in the text with every "\r\n" read as "\n". */
function toLfOffset(starts: readonly number[], offset: number): number {
  let before = 0;
  while (before < starts.length && starts[before]! < offset) { before += 1; }
  return offset - before;
}

/** The offset in the document of an offset in its LF text. */
function toDocumentOffset(starts: readonly number[], offset: number): number {
  let result = offset;
  starts.forEach((start, index) => {
    // The "\n" of this break sits at LF offset `start - index`; offsets after it are one further in the document.
    if (offset > start - index) { result += 1; }
  });
  return result;
}

export function createSourcePresence(deps: {
  document: Pick<vscode.TextDocument, "uri" | "getText" | "eol">;
  publish(uri: vscode.Uri, selection: { anchor: number; head: number }): void;
  /** Called on dispose to drop the published selection. */
  unpublish?(uri: vscode.Uri): void;
  subscribePeers(uri: vscode.Uri, listener: (peers: PeerSelection[]) => void): () => void;
  post(message: { type: "peers"; peers: PeerSelection[] } | { type: "reveal"; line: number }): void;
}): { selection(message: { type: "selection"; anchor: number; head: number; line: number }): void; dispose(): void } {
  const { document } = deps;
  const startsOf = (): readonly number[] => (document.eol === CRLF ? crlfStarts(document.getText()) : []);
  const stop = deps.subscribePeers(document.uri, (peers) => {
    const starts = startsOf();
    deps.post({ type: "peers", peers: peers.map((peer) => ({ ...peer, anchor: toLfOffset(starts, peer.anchor), head: toLfOffset(starts, peer.head) })) });
  });
  return {
    selection({ anchor, head }) {
      const starts = startsOf();
      deps.publish(document.uri, { anchor: toDocumentOffset(starts, anchor), head: toDocumentOffset(starts, head) });
    },
    dispose() { stop(); deps.unpublish?.(document.uri); },
  };
}
