// Runs one shared project in this page while the page holds the share's tab lease and waits for the lease while another tab does, binds the editor to its shared text, and connects the page to the share.
// CONTRACT: documents/contracts/collaboration.md#device-local-state
import { EditorState, type Extension, RangeSetBuilder } from "@codemirror/state";
import { EditorView, keymap, Decoration, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import {
  lineAt, createSharedProjectComments, derivePeerColour, deriveRelativeSelection, deriveAbsoluteSelection, connectShare, posixPathOps,
  type ILogger, type ShareConnection, type ShareConnectionState, type Comment, type CommentThread, type ShareSession, type TextRange, type PresenceStore,
  type Invite, type MirrorFactory, type MirrorStart, type ProjectFolderRegistry, type RelayNetwork, type ShareStart,
} from "@labshelf/core";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";
import { openBrowserCollabStorage, updateTabLease, createTabLeaseName, watchTabLease, type LibraryLocations, type TabLease } from "../storage";
import type { CommentThreads, LocatedThread } from "./comments";
import { startBrowserProjectMirror, type BrowserMirrorStart } from "./mirror";

const MODULE = "collab.liveComments";

interface LiveCommentThreadsOptions {
  session: Pick<ShareSession, "index" | "openDoc">;
  /** The id of the project the share holds. */
  projectId: string;
  /** This user's name on the comments they write. */
  author: () => string;
  logger: ILogger;
}

function createLiveCommentThreads({ session, projectId, author, logger }: LiveCommentThreadsOptions): CommentThreads {
  const comments = createSharedProjectComments(session);
  const checkProject = (id: string): void => {
    if (id !== projectId) { throw new Error(`Project ${id} is not the shared project ${projectId}, so its comments cannot be used`); }
  };
  const located = (thread: CommentThread): LocatedThread => {
    const range = comments.locate(thread);
    const text = comments.textOf(thread.file);
    return { ...thread, line: range === "detached" || text === undefined ? undefined : lineAt(text, range.start) };
  };
  const newComment = (body: string): Comment => ({ id: globalThis.crypto.randomUUID(), author: author(), body, createdAt: new Date().toISOString() });
  const edit = async (action: string, threadId: string, change: () => void): Promise<void> => {
    try {
      change();
    } catch (error) {
      await logger.error(MODULE, error, { action, projectId, threadId });
      throw error;
    }
  };
  const rangesOf = (path: string): TextRange[] => comments.threads().filter((each) => each.file === path && !each.resolved)
    .map((each) => comments.locate(each)).filter((each): each is TextRange => each !== "detached");

  return {
    async threads(id, path) {
      checkProject(id);
      return comments.threads().filter((each) => path === undefined || each.file === path).map(located);
    },
    commentAnchorsFor: (id, path) => ({
      subscribe(listener) {
        checkProject(id);
        listener(rangesOf(path));
        return comments.onChange(() => listener(rangesOf(path)));
      },
    }),
    async addComment(id, path, range, body) {
      checkProject(id);
      const threadId = globalThis.crypto.randomUUID();
      await edit("add a comment", threadId, () => comments.add({ id: threadId, file: path, anchor: comments.anchor(path, range), comments: [newComment(body)], resolved: false }));
      await logger.log("INFO", MODULE, "Added a comment to a shared file", { projectId, path, threadId });
    },
    reply: (threadId, body) => edit("reply to a comment", threadId, () => comments.reply(threadId, newComment(body))),
    resolve: (threadId) => edit("resolve a comment", threadId, () => comments.setResolved(threadId, true)),
    onDidChange: (listener) => comments.onChange(listener),
  };
}

const LOG_MODULE = "collab.shares";

export type ShareEntryState = { kind: "observer" } | { kind: "connected"; connection: ShareConnectionState };

/** What the editor and the comments of a shared project use while this page runs its connection. */
export interface LiveShare {
  session: ShareConnection["session"];
  presence: ShareConnection["presence"];
  comments: CommentThreads;
}

export interface ShareEntryOptions {
  shareId: string;
  libraryId: string;
  /** The project's id, which its comments carry; undefined when the project list does not hold it yet. */
  projectId: string | undefined;
  /** Opens the share again under `lease` once another tab let it go; undefined when this device holds no key of it any more. */
  reopen(lease: TabLease): Promise<ShareConnection | undefined>;
  name: () => string;
  logger: ILogger;
  /** Called on every state change of the entry or its connection. */
  notify(): void;
  /** Called once the entry stops for good without a close: its share was left while this tab waited. */
  ended(): void;
}

export class ProjectShare {
  private connection: ShareConnection | undefined;
  private comments: CommentThreads | undefined;
  private lease: TabLease | undefined;
  private waiting: AbortController | undefined;
  private stopState: (() => void) | undefined;
  private closed = false;

  constructor(private readonly options: ShareEntryOptions) {}

  get projectId(): string | undefined { return this.options.projectId; }

  get running(): ShareConnection | undefined { return this.connection; }

  live(): LiveShare | undefined {
    const { connection, comments } = this;
    return connection && comments ? { session: connection.session, presence: connection.presence, comments } : undefined;
  }

  state(): ShareEntryState {
    return this.connection ? { kind: "connected", connection: this.connection.state() } : { kind: "observer" };
  }

  /** Keeps a connection opened under `lease`. */
  adopt(lease: TabLease, connection: ShareConnection): void {
    this.waiting?.abort();
    this.lease = lease;
    lease.onLost(() => { if (this.lease === lease) { void this.lost(); } });
    this.connection = connection;
    const { projectId, logger, name } = this.options;
    this.comments = projectId === undefined ? undefined : createLiveCommentThreads({ session: connection.session, projectId, author: name, logger });
    this.stopState = connection.onStateChange(this.options.notify);
    this.options.notify();
  }

  /** Waits for the lease and reopens the share when another tab closes, dies or hands it over. */
  observe(): void {
    if (this.closed || this.connection || this.waiting) { return; }
    const waiting = this.waiting = new AbortController();
    this.options.notify();
    const { logger, shareId } = this.options;
    watchTabLease(this.leaseName(), waiting.signal).then(
      (lease) => this.reopen(lease).catch((error: unknown) => logger.error(LOG_MODULE, error, { action: "reopen a share after the lease came free", shareId })),
      (error: unknown) => { if (!waiting.signal.aborted) { void logger.error(LOG_MODULE, error, { action: "wait for the share's tab lease", shareId }); } },
    ).finally(() => { if (this.waiting === waiting) { this.waiting = undefined; } });
  }

  /** Takes the lease from the tab that holds it ("Use here"); that tab then observes. */
  async takeOver(): Promise<void> {
    if (this.connection || this.closed) { return; }
    this.waiting?.abort();
    await this.reopen(await updateTabLease(this.leaseName()));
  }

  /** Stops waiting, closes the connection and frees the lease; rejects when the close leaves an update unstored. */
  async close(): Promise<void> {
    this.closed = true;
    this.waiting?.abort();
    try {
      await this.disconnect();
    } finally {
      await this.lease?.release();
      this.lease = undefined;
    }
  }

  private leaseName(): string {
    return createTabLeaseName(this.options.libraryId, this.options.shareId);
  }

  private async reopen(lease: TabLease): Promise<void> {
    if (this.closed) { await lease.release(); return; }
    let connection: ShareConnection | undefined;
    try {
      connection = await this.options.reopen(lease);
    } catch (error) {
      await lease.release();
      this.options.ended();
      throw error;
    }
    if (connection && !this.closed) { this.adopt(lease, connection); return; }
    await connection?.close().catch((error: unknown) =>
      this.options.logger.error(LOG_MODULE, error, { action: "close a share reopened while the page closed", shareId: this.options.shareId }));
    await lease.release();
    if (!connection) { this.options.ended(); }
  }

  /**
   * Another tab took the lease: the mirror already stopped writing, so the connection closes and this tab observes.
   * INVARIANT: closing still flushes this tab's pending updates to the share's state; appends only add, so the new owner loses none.
   */
  private async lost(): Promise<void> {
    const { logger, shareId } = this.options;
    void logger.log("INFO", LOG_MODULE, "Another tab took the shared project over", { shareId });
    this.lease = undefined;
    await this.disconnect().catch((error: unknown) => logger.error(LOG_MODULE, error, { action: "close a share another tab took over", shareId }));
    this.observe();
  }

  private async disconnect(): Promise<void> {
    const { connection } = this;
    this.connection = undefined;
    this.comments = undefined;
    this.stopState?.();
    this.stopState = undefined;
    if (!connection) { return; }
    this.options.notify();
    await connection.close();
  }
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

export function createRemoteCursors(options: RemoteCursorsOptions): Extension {
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

export function createCollabExtensions(options: CollabExtensionsOptions): Extension {
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
    createRemoteCursors(options),
  ];
}

export type ShareSources = Pick<LibraryLocations, "fileSystem" | "folderFileSystem" | "browserFileSystem" | "getLibrarySource" | "onLibraryFilesChanged">;

export interface BrowserShareOptions {
  invite: Pick<Invite, "shareId" | "shareKey" | "relays">;
  /** The library the project lives in; the share's state is stored under it. */
  libraryId: string;
  /** The share's tab lease, held by the caller for the whole connection. */
  tab: TabLease;
  sources: ShareSources;
  name: string;
  logger: ILogger;
  network?: RelayNetwork | undefined;
  start: ShareStart;
}

// The browser library keeps every project inside the library, so it has no outside folders to register.
const noOutsideFolders: ProjectFolderRegistry = { folders: async () => [], register: async () => undefined, unregister: async () => undefined };

function toMirrorStart(result: BrowserMirrorStart): MirrorStart {
  return result.kind === "running" ? result : { kind: "busy", holder: result.holder };
}

export function connectBrowserShare({ invite, libraryId, tab, sources, name, logger, network, start }: BrowserShareOptions): Promise<ShareConnection> {
  const { shareId, shareKey, relays } = invite;
  const startMirror: MirrorFactory = async ({ folder, session, blobs, store, onStopped }) => toMirrorStart(await startBrowserProjectMirror({
    sources, libraryId, shareId, folder, session, blobs, store, logger, tab, onStopped,
  }));
  return connectShare({
    shareId, shareKey, relays, name, logger, startMirror,
    storage: openBrowserCollabStorage(`${libraryId}/${shareId}`),
    projects: { context: { fs: sources.fileSystem, paths: posixPathOps, logger, registry: noOutsideFolders }, libraryRoot: "" },
    ...(network ? { network } : {}),
  }, start);
}
