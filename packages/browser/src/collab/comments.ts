// Shows and stores a project's comment threads: the store over comments.qmd, its routing to a share's live threads, and the editor's marks and Add comment action.
// CONTRACT: documents/contracts/collaboration.md#comments
import { type Extension, Prec, RangeSet, StateEffect, StateField, type Text } from "@codemirror/state";
import { EditorView, keymap, showPanel, Decoration, gutter, GutterMarker } from "@codemirror/view";
import {
  addThread, lineAt, deriveAnchor, COMMENTS_PATH, deriveCommentThreads, updateCommentsDocument, loadCommentsDocument, findThread, posixPathOps, addThreadReply, setThreadResolved, renderIcon,
  type Comment, type CommentsFileAccess, type CommentThread, type ILogger, type LibraryFileSystem, type TextRange,
} from "@labshelf/core";
import { mountFormDialog, mountQmdEditor, renderElement, showToast, type QmdEditorHandle } from "@labshelf/core/dom";
import { createSourceFooter } from "../libraryUi";
import type { ProjectSession } from "../writing";
import type { PageShares } from "./pageShares";

const THREADS_MODULE = "collab.comments";
const AUTHOR = "You";
/** mountQmdEditor reports an edit 300 ms after the last one and cannot be flushed, so a body read right after typing waits this long. */
const CHANGE_SETTLE_MS = 350;

/** A thread with its place in the file's saved text. */
export interface LocatedThread extends CommentThread {
  /** One-based line of the commented text; undefined when the text is gone from the file. */
  line: number | undefined;
}

export interface CommentThreads {
  /** The project's threads in file order of the store, optionally of one file. Throws when comments.qmd is not valid. */
  threads(projectId: string, path?: string): Promise<LocatedThread[]>;
  /** Calls the listener now and after each change with the ranges of the file's open threads. */
  commentAnchorsFor(projectId: string, path: string): { subscribe(listener: (ranges: TextRange[]) => void): () => void };
  addComment(projectId: string, path: string, range: TextRange, text: string): Promise<void>;
  /** Replies in the open project. */
  reply(threadId: string, text: string): Promise<void>;
  /** Resolves a thread of the open project. */
  resolve(threadId: string): Promise<void>;
  /** Calls the listener after a thread was added, replied to or resolved here. */
  onDidChange(listener: () => void): () => void;
}

export interface CommentThreadsOptions {
  fs: LibraryFileSystem;
  session: Pick<ProjectSession, "current">;
  logger: ILogger;
}

type Session = Pick<ProjectSession, "current">;

function openFolder(session: Session, projectId?: string): string {
  const entry = session.current();
  if (entry?.kind !== "ready" || (projectId !== undefined && entry.settings.id !== projectId)) {
    throw new Error(`Project ${projectId ?? "(none)"} is not the open project, so its comments cannot be used`);
  }
  return entry.folder;
}

function accessOf(fs: LibraryFileSystem, folder: string): CommentsFileAccess {
  const file = posixPathOps.join(folder, COMMENTS_PATH);
  return {
    read: async () => (await fs.exists(file) ? fs.readText(file) : undefined),
    write: async (text) => { await fs.ensureDir(posixPathOps.dirname(file)); await fs.writeText(file, text); },
  };
}

async function readFileText(fs: LibraryFileSystem, folder: string, path: string): Promise<string | undefined> {
  const file = posixPathOps.join(folder, path);
  return await fs.exists(file) ? fs.readText(file) : undefined;
}

async function stored(fs: LibraryFileSystem, folder: string): Promise<CommentThread[]> {
  const doc = await loadCommentsDocument(accessOf(fs, folder));
  if (!doc) { throw new Error(`${COMMENTS_PATH} is not a valid comments file. Fix the file to see and add comments.`); }
  return deriveCommentThreads(doc);
}

async function locateThreads(fs: LibraryFileSystem, folder: string, path: string | undefined): Promise<LocatedThread[]> {
  const inFile = (await stored(fs, folder)).filter((each) => path === undefined || each.file === path);
  const texts = new Map<string, string | undefined>();
  for (const file of new Set(inFile.map((each) => each.file))) { texts.set(file, await readFileText(fs, folder, file)); }
  return inFile.map((each) => {
    const text = texts.get(each.file);
    const range = text === undefined ? "detached" : findThread(each, text);
    return { ...each, line: range === "detached" ? undefined : lineAt(text!, range.start) };
  });
}

async function openRanges(fs: LibraryFileSystem, folder: string, path: string): Promise<TextRange[]> {
  const text = await readFileText(fs, folder, path);
  if (text === undefined) { return []; }
  const located = (await stored(fs, folder)).filter((each) => each.file === path && !each.resolved).map((each) => findThread(each, text));
  return located.filter((each): each is TextRange => each !== "detached");
}

const newComment = (body: string): Comment => ({ id: globalThis.crypto.randomUUID(), author: AUTHOR, body, createdAt: new Date().toISOString() });

export function createCommentThreads({ fs, session, logger }: CommentThreadsOptions): CommentThreads {
  const listeners = new Set<() => void>();
  const notify = (): void => { for (const listener of [...listeners]) { listener(); } };
  const onDidChange = (listener: () => void): (() => void) => { listeners.add(listener); return () => void listeners.delete(listener); };

  const edit = async (folder: string, change: Parameters<typeof updateCommentsDocument>[1], action: string): Promise<void> => {
    try {
      await updateCommentsDocument(accessOf(fs, folder), change);
    } catch (error) {
      await logger.error(THREADS_MODULE, error, { action, folder });
      throw error;
    }
    notify();
  };
  const rangesOf = async (projectId: string, path: string): Promise<TextRange[]> => openRanges(fs, openFolder(session, projectId), path);

  return {
    threads: async (projectId, path) => locateThreads(fs, openFolder(session, projectId), path),
    onDidChange,
    commentAnchorsFor: (projectId, path) => ({
      subscribe(listener) {
        const push = (): void => {
          rangesOf(projectId, path).then(listener, (error: unknown) => {
            void logger.error(THREADS_MODULE, error, { action: "read comment anchors", projectId, path });
            listener([]);
          });
        };
        push();
        return onDidChange(push);
      },
    }),
    async addComment(projectId, path, range, text) {
      const folder = openFolder(session, projectId);
      const source = await readFileText(fs, folder, path);
      if (source === undefined) { throw new Error(`${path} does not exist in the project, so it cannot be commented`); }
      const thread: CommentThread = { id: globalThis.crypto.randomUUID(), file: path, anchor: deriveAnchor(source, range.start, range.end), comments: [newComment(text)], resolved: false };
      await edit(folder, (doc) => addThread(doc, thread), "add a comment");
    },
    reply: (threadId, text) => edit(openFolder(session), (doc) => addThreadReply(doc, threadId, newComment(text)), "reply to a comment"),
    resolve: (threadId) => edit(openFolder(session), (doc) => setThreadResolved(doc, threadId, true), "resolve a comment"),
  };
}


export interface RoutedCommentThreadsOptions {
  /** The store over comments.qmd. */
  files: CommentThreads;
  shares: Pick<PageShares, "live" | "onChange">;
  session: Pick<ProjectSession, "current">;
}

export function createRoutedCommentThreads({ files, shares, session }: RoutedCommentThreadsOptions): CommentThreads {
  const storeFor = (projectId: string | undefined): CommentThreads => (projectId === undefined ? undefined : shares.live(projectId)?.comments) ?? files;
  const openProject = (): string | undefined => {
    const entry = session.current();
    return entry?.kind === "ready" ? entry.settings.id : undefined;
  };
  return {
    threads: (projectId, path) => storeFor(projectId).threads(projectId, path),
    addComment: (projectId, path, range, text) => storeFor(projectId).addComment(projectId, path, range, text),
    reply: (threadId, text) => storeFor(openProject()).reply(threadId, text),
    resolve: (threadId) => storeFor(openProject()).resolve(threadId),
    commentAnchorsFor: (projectId, path) => ({
      subscribe(listener) {
        let stop = storeFor(projectId).commentAnchorsFor(projectId, path).subscribe(listener);
        const stopShares = shares.onChange(() => { stop(); stop = storeFor(projectId).commentAnchorsFor(projectId, path).subscribe(listener); });
        return () => { stopShares(); stop(); };
      },
    }),
    onDidChange(listener) {
      const live = (): CommentThreads | undefined => { const id = openProject(); return id === undefined ? undefined : shares.live(id)?.comments; };
      let stopLive = live()?.onDidChange(listener);
      const stopFiles = files.onDidChange(listener);
      const stopShares = shares.onChange(() => { stopLive?.(); stopLive = live()?.onDidChange(listener); listener(); });
      return () => { stopShares(); stopFiles(); stopLive?.(); };
    },
  };
}

/** The document offset of `offset` in the file text `readFileText`. */
function fileOffsetToDoc(fileText: string, offset: number): number {
  if (!fileText.includes("\r\n")) return offset;
  const before = fileText.slice(0, offset);
  return offset - (before.match(/\r\n/g)?.length ?? 0);
}

/** The file offset of document offset `offset`, for a file whose line break is `lineBreak`. */
function docOffsetToFile(doc: Text, lineBreak: string, offset: number): number {
  return lineBreak === "\r\n" ? offset + doc.lineAt(offset).number - 1 : offset;
}

interface CommentMarks {
  extension: Extension;
  /** Replaces the marked ranges, given in document offsets. */
  setRanges(view: EditorView, ranges: readonly TextRange[]): void;
}

const replaceRanges = StateEffect.define<readonly TextRange[]>();

// INVARIANT: ranges are kept in document offsets; an edit that deletes a range leaves it empty and it is not drawn.
const rangesField = StateField.define<readonly TextRange[]>({
  create: () => [],
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(replaceRanges)) return effect.value;
    if (!transaction.docChanged) return value;
    return value.map((range) => ({ start: transaction.changes.mapPos(range.start, 1), end: transaction.changes.mapPos(range.end, -1) }));
  },
});

class CommentMarker extends GutterMarker {
  constructor(private readonly open: () => void) { super(); }
  eq(): boolean { return true; }
  toDOM(): HTMLElement {
    const button = document.createElement("button");
    button.className = "ls-comment-marker";
    button.type = "button";
    button.title = "Open comments";
    button.setAttribute("aria-label", "Open comments");
    button.innerHTML = renderIcon("message");
    button.addEventListener("click", this.open);
    return button;
  }
}

const rangeMark = Decoration.mark({ class: "ls-comment-range" });

function commentMarks(open: () => void): CommentMarks {
  const marker = new CommentMarker(open);
  const visible = (state: EditorView["state"]): TextRange[] =>
    state.field(rangesField).filter((range) => range.end > range.start && range.start >= 0 && range.end <= state.doc.length);
  const decorations = EditorView.decorations.compute([rangesField], (state) =>
    Decoration.set(visible(state).map((range) => rangeMark.range(range.start, range.end)), true));
  const markerGutter = gutter({
    class: "ls-comment-gutter",
    markers: (view) => RangeSet.of(visible(view.state).map((range) => marker.range(view.state.doc.lineAt(range.start).from)), true),
  });
  return {
    extension: [rangesField, decorations, markerGutter],
    setRanges: (view, ranges) => view.dispatch({ effects: replaceRanges.of(ranges) }),
  };
}

/** @param add receives the selection in document offsets. */
export function addCommentSupport(add: (range: TextRange) => void): Extension {
  const run = (view: EditorView): boolean => {
    const { from, to, empty } = view.state.selection.main;
    if (empty) return false;
    add({ start: from, end: to });
    return true;
  };
  const panel = showPanel.of((view) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ls-btn ls-add-comment";
    button.innerHTML = `${renderIcon("message")}Add comment`;
    button.title = "Add comment on the selection (Ctrl/Cmd+Alt+M)";
    button.disabled = view.state.selection.main.empty;
    button.addEventListener("click", () => run(view));
    return { ...createSourceFooter(button), update: (update) => { button.disabled = update.state.selection.main.empty; } };
  });
  return [Prec.high(keymap.of([{ key: "Mod-Alt-m", run }])), panel];
}

const EDITOR_MODULE = "editor.comments";

export interface BodyInput {
  editor: QmdEditorHandle;
  /** The body as typed, once the editor has reported the last edit. */
  body(): Promise<string>;
}

/** Mounts an editable core editor for a comment body in `host`; Mod-Enter calls `onSubmit` and Escape calls `onCancel`. */
export function mountBodyInput(host: HTMLElement, { onSubmit, onCancel }: { onSubmit(): void; onCancel?(): void }): BodyInput {
  let body = "";
  let dirty = false;
  const isSubmit = (event: KeyboardEvent): boolean => event.key === "Enter" && (event.metaKey || event.ctrlKey);
  host.addEventListener("input", () => { dirty = true; }, true);
  host.addEventListener("keydown", (event) => {
    if (isSubmit(event)) { event.preventDefault(); event.stopPropagation(); onSubmit(); return; }
    if (event.key === "Escape" && onCancel) { event.preventDefault(); event.stopPropagation(); onCancel(); return; }
    if (!["Control", "Meta", "Alt", "Shift", "Escape"].includes(event.key)) { dirty = true; }
  }, true);
  const editor = mountQmdEditor(host, { body: "", onChange: (value) => { body = value; dirty = false; } });
  return {
    editor,
    async body() {
      if (dirty) { await new Promise((resolve) => setTimeout(resolve, CHANGE_SETTLE_MS)); }
      return body;
    },
  };
}

/** Opens the Add comment dialog; resolves the typed comment, or undefined when it is dismissed. */
function askCommentBody(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const host = renderElement("div", { class: "ls-comment-editor" });
    const error = renderElement("p", { class: "ls-comment-status", role: "alert" });
    const form = renderElement("form", { class: "ls-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Add comment", novalidate: true },
      renderElement("h2", { text: "Add comment" }), host, error);
    let settled = false;
    let submitting = false;
    const submit = async (): Promise<void> => {
      if (submitting) return;
      submitting = true;
      const text = (await input.body()).trim();
      submitting = false;
      if (text === "") { error.textContent = "Write a comment"; return; }
      settle(text);
      close();
    };
    const input = mountBodyInput(host, { onSubmit: () => void submit() });
    const settle = (value: string | undefined): void => {
      if (settled) return;
      settled = true;
      input.editor.destroy();
      resolve(value);
    };
    const close = mountFormDialog(form, { submitLabel: "Add comment", unsubscribe: () => settle(undefined) });
    form.addEventListener("submit", (event) => { event.preventDefault(); void submit(); });
    input.editor.focus();
  });
}

/** What the editor needs from the comment threads of its file; ranges are offsets in the saved file text. */
export interface EditorComments {
  /** The listener runs with the ranges of the file's unresolved threads now and after each change. */
  subscribe(listener: (ranges: TextRange[]) => void): () => void;
  add(range: TextRange, text: string): Promise<void>;
  /** Opens the comments tab. */
  open(): void;
}

export interface CommentSupportDeps {
  comments: EditorComments;
  lineBreak: string;
  /** The text last written to the file. */
  savedText(): string;
  /** Saves pending edits; resolves whether the file is saved afterwards. */
  flush(): Promise<boolean>;
  logger: ILogger;
}

export interface CommentSupport {
  extensions: Extension[];
  /** Starts following the file's threads; returns the stop function. */
  attach(view: EditorView): () => void;
}

export function createCommentSupport(deps: CommentSupportDeps): CommentSupport {
  const { comments, logger } = deps;
  const marks = commentMarks(comments.open);
  let view: EditorView | undefined;
  // The saved file is what the store anchors the thread in, so the edits are written before the offsets are read.
  const addOnSelection = async (range: TextRange): Promise<void> => {
    const text = await askCommentBody();
    if (!text || !view) return;
    if (!(await deps.flush())) { showToast("Could not save the file, so the comment was not added.", "error"); return; }
    const { doc } = view.state;
    await comments.add(
      { start: docOffsetToFile(doc, deps.lineBreak, range.start), end: docOffsetToFile(doc, deps.lineBreak, range.end) }, text,
    );
  };
  const add = (range: TextRange): void => {
    addOnSelection(range).catch((error: unknown) => {
      void logger.error(EDITOR_MODULE, error, { action: "addComment" });
      showToast("Could not add the comment.", "error");
    });
  };
  return {
    extensions: [marks.extension, addCommentSupport(add)],
    attach(editorView) {
      view = editorView;
      return comments.subscribe((ranges) => marks.setRanges(editorView, ranges.map((range) => ({
        start: fileOffsetToDoc(deps.savedText(), range.start), end: fileOffsetToDoc(deps.savedText(), range.end),
      }))));
    },
  };
}
