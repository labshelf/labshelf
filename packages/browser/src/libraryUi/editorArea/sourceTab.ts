// Shows a project source file in the lazily loaded source editor: a local file on disk, a shared file in its share's text.
import {
  createLoopbackTransport, formatError,
  type HostToSearch, type ProjectEntry, type SearchToHost, type SearchTransport, type SelectionPopupPrefs, type TypingHelpers,
} from "@labshelf/core";
import { mountFloatingSearch, renderElement, runShareProjectDialog, showToast, type FloatingSearch } from "@labshelf/core/dom";
import type { createDeckWorkspaceFeed } from "@labshelf/core/deckWorkspace";
import { createDeckToolbarGroups, readDeckKindOf, renderSourceMoreEntries, renderSourceToolbar, reviewModeDropdown, type DeckToolHooks, type SourceEditor, type SourceEditorDeps, type SourceToolbarButton } from "@labshelf/core/sourceEditor";
import type { Consult } from "@labshelf/core/consult";
import { createEditorConsultActions } from "@labshelf/core/consult";
import { createBrowserConsult, deriveConsultCodePath } from "../../consult/consultHost";
import type { LiveFiles } from "../../localSync/liveFiles";
import { readPageLiveFiles } from "../../storage/libraryFileSystem";
import {
  createSourceActions, deriveSourceLanguage, findProject, loadSourceEditor, mountOnTakeover, mountSearchHost, openSharedProjectHere, readSourceFileMode, renderObservingNotice, renderUnresolvedNotice, showInOpenEditor, splitSourceActions,
  type SourceFileMode,
} from "../../writing";
import { editorPrefsOf } from "../../writing/editorPrefs";
import { followProjectFileChanges, warnFileChangeConflict } from "../../writing/fileChanges";
import { mountWorkspaceInTab } from "./deckWorkspaceTab";
import { isArticleSource, mountInlinePreview, type InlinePreview } from "./inlinePreview";
import { createReviewModeState, editorDeps, fullPathOf, type ReviewModeState } from "./sourceEditorDeps";
import { findSharedProject } from "../projectChat";
import { TAB_KINDS, type TabContext, type TabModule } from "./tabKinds";
import { openDeckAudienceTab } from "./workspace";

type DeckFeed = ReturnType<typeof createDeckWorkspaceFeed>;

const MODULE = "tabs.source";

/** A live file this tab holds, and the collab the editor is mounted over; `release` lets the file go. */
interface LiveBinding { collab: NonNullable<SourceEditorDeps["collab"]>; release: () => Promise<void> }

/** The page's live files; undefined when the page cannot start them, and it then edits the files as it did before. */
const readLiveFiles = ({ logger }: TabContext): Promise<LiveFiles | undefined> =>
  Promise.resolve().then(readPageLiveFiles).catch((error: unknown) => { void logger.error(MODULE, error, { action: "readLiveFiles", message: formatError(error) }); return undefined; });

/** Opens a local file as a live file, so every tab of it edits one replica; undefined when the replica fails, and the editor then reads the disk. */
async function openLiveBinding({ logger }: TabContext, live: LiveFiles, entry: ProjectEntry, file: { projectId: string; path: string }): Promise<LiveBinding | undefined> {
  const opened = live.open(fullPathOf(entry, file.path));
  try {
    await opened.replica.ready;
  } catch (error) {
    void logger.error(MODULE, error, { action: "openLiveFile", ...file, message: formatError(error) });
    await opened.release();
    return undefined;
  }
  return { collab: { text: opened.replica.doc.getText("content"), persist: () => opened.flush() }, release: () => opened.release() };
}

/** Mounts the file's editor in `body`; undefined when the tab closed first or the file could not be opened, which the body then says. */
async function loadEditor(
  body: HTMLElement, context: TabContext, file: { projectId: string; path: string; retried: boolean; inserts: SourceInserts }, review: ReviewModeState, disposed: () => boolean,
): Promise<{ editor: SourceEditor; entry: ProjectEntry; mode: SourceFileMode; feed: DeckFeed | undefined; stopTyping: () => void; release: () => Promise<void>; consult: Consult | undefined } | undefined> {
  const { fs, logger, project } = context;
  const { projectId, path, retried } = file;
  const { session, sharing } = project();
  const loading = body.appendChild(renderElement("p", { class: "ls-workspace-placeholder" }, `Loading ${path}…`));
  let live: LiveBinding | undefined;
  let consult: Consult | undefined;
  // The consult windows close before the tab lets its own replica go, which a window of the same file shares.
  const release = async (): Promise<void> => {
    await consult?.dispose();
    await live?.release();
  };
  try {
    const loadingModule = loadSourceEditor();
    const entry = await findProject(fs, logger, session.current(), projectId);
    const { mountSourceEditor } = await loadingModule;
    if (disposed()) return undefined;
    const mode = await readSourceFileMode(sharing, entry, path, logger, retried);
    if (disposed()) return undefined;
    const pageLive = await readLiveFiles(context);
    live = mode.kind === "local" && pageLive ? await openLiveBinding(context, pageLive, entry, { projectId, path }) : undefined;
    if (disposed()) { await release(); return undefined; }
    // A talk's or poster's workspace hears the editor's text and cursor through this feed.
    const feed = /\.(tex|typ)$/.test(path) ? (await import("@labshelf/core/deckWorkspace")).createDeckWorkspaceFeed() : undefined;
    // The typing helpers start as the library file has them and follow it while the editor is open.
    const prefs = editorPrefsOf(fs, logger);
    const typing = await prefs.typing();
    const selectionPopup = await prefs.selectionPopup();
    if (disposed()) { await release(); return undefined; }
    // Without the page's replica hub there is nothing for a consult window to share, so the editor shows no consult footer.
    // The bibliography update after a citation saves the file through the editor that is mounted by then; the consult windows write into it too.
    let mounted: SourceEditor | undefined;
    const folder = entry.folder;
    consult = pageLive ? createBrowserConsult({ fs, logger, live: pageLive, projectId, actions: () => mounted && createEditorConsultActions(mounted, (ref) => deriveConsultCodePath(folder, ref)) }) : undefined;
    const collab = mode.kind === "shared" ? mode.collab : live?.collab;
    const editor = await mountSourceEditor(body, { ...editorDeps(context, entry, { projectId, path }, mode, review, feed, async () => (await mounted?.flush()) ?? false, collab, consult), typing, selectionPopup, inserts: file.inserts });
    mounted = editor;
    loading.remove();
    if (disposed()) { void editor.dispose().then(release); return undefined; }
    return { editor, entry, mode, feed, stopTyping: stopFollowingPrefs(prefs, editor), release, consult };
  } catch (error) {
    void release();
    loading.textContent = `Could not open ${path}.`;
    void logger.error(MODULE, error, { action: "openSource", projectId, path });
    return undefined;
  }
}

/** Saves the editor's pending edits when the page goes and keeps the tab open while they cannot be saved; returns the function that stops it. */
function guardUnsavedEdits({ logger, tab }: TabContext, { projectId, path }: { projectId: string; path: string }, editor: () => SourceEditor | undefined): () => void {
  // PLATFORM: pagehide is the last event a closing page reliably gets; the write is best effort once it has started.
  const flushOnLeave = (): void => { void editor()?.flush(); };
  window.addEventListener("pagehide", flushOnLeave);
  window.addEventListener("beforeunload", flushOnLeave);
  tab.onBeforeClose(async () => {
    const open = editor();
    if (!open || (await open.flush())) return true;
    void logger.log("WARN", MODULE, "kept the tab open: the file could not be saved", { projectId, path });
    showToast(`Could not save ${path}. The tab stays open so no edit is lost.`, "error");
    return false;
  });
  return () => {
    window.removeEventListener("pagehide", flushOnLeave);
    window.removeEventListener("beforeunload", flushOnLeave);
  };
}

function prependNotice(body: HTMLElement, mode: SourceFileMode, on: { retry: () => void; useHere: () => void }): void {
  if (mode.kind === "unresolved") body.prepend(renderUnresolvedNotice(on.retry));
  if (mode.kind === "observing") body.prepend(renderObservingNotice(on.useHere));
}

/** What a source tab holds while it is open: the editor, the project entry its insert actions target (none while read-only) and the shared file's mode. */
interface SourceTabState {
  disposed: boolean;
  editor: SourceEditor | undefined;
  loaded: ProjectEntry | undefined;
  mode: SourceFileMode | undefined;
  /** Ends the editor's following of the typing helpers and the selection popup in editor-prefs.json. */
  stopTyping?: (() => void) | undefined;
  /** Closes the tab's consult windows, then lets the file's live file go; runs after the editor that edits its replica is disposed. */
  release?: (() => Promise<void>) | undefined;
  /** The tab's consult windows: the toolbar's Consult opens their chooser; undefined without the page's live files. */
  consult?: Consult | undefined;
  /** The project search floating over the editor; its host side starts on the first open. */
  search?: FloatingSearch;
  /** An article's PDF beside its code; undefined for a talk, a poster or any other file. */
  inline?: InlinePreview | undefined;
  searchHost?: { dispose(): void };
}

/** The editor follows the typing helpers and the selection popup of editor-prefs.json; returns the stop function. */
function stopFollowingPrefs(prefs: ReturnType<typeof editorPrefsOf>, editor: SourceEditor): () => void {
  const stops = [prefs.onChange((next) => editor.typing.set(next)), prefs.onSelectionPopupChange((next) => editor.selectionPopup.set(next))];
  return () => { for (const stop of stops) stop(); };
}

const isReadOnly = (mode: SourceFileMode | undefined): boolean => mode === undefined || mode.kind === "unresolved" || mode.kind === "observing";

/** The bar's collaboration end: whether the project is shared with someone, then the Project chat and Share; the PDF toggle after them. */
interface ToolbarEnd { shared(): boolean; trailing(): SourceToolbarButton[]; edge: SourceToolbarButton; saveSpelling(on: boolean): void; saveTyping(next: TypingHelpers): void; saveSelectionPopup(next: SelectionPopupPrefs): void }

/**
 * The toolbar offers the mode dropdown only while a writable editor of a shared project is open; `element` is the one on screen.
 * The end's trailing buttons follow the review dropdown, shown read-only or not; the PDF toggle and the ⋯ menu end the bar.
 */
function createToolbarSlot(groups: ReturnType<typeof splitSourceActions>["toolbar"], end: ToolbarEnd, review: () => ReviewModeState, editor: () => SourceEditor | undefined, deck: { path: string; hooks: DeckToolHooks }): {
  element(): HTMLElement; show(withReview: boolean): void; reset(): HTMLElement; redraw(): void;
} {
  const history: SourceToolbarButton[] = [{ label: "Undo", glyph: "undo-2", run: () => editor()?.undo() }, { label: "Redo", glyph: "redo-2", run: () => editor()?.redo() }];
  const build = (withReview: boolean): HTMLElement => {
    const last = [
      ...(withReview && end.shared() ? [reviewModeDropdown(() => review().get(), (picked) => { review().set(picked); editor()?.setReviewMode(picked); })] : []),
      ...end.trailing(),
    ];
    // The last group is the project's tools (search, indent, history): it joins the collaboration at the right.
    const right = [...groups.slice(-1), ...(last.length > 0 ? [last] : [])];
    // A talk's or poster's tools come first, once its editor has loaded.
    return renderSourceToolbar([...createDeckToolbarGroups(deck.path, editor()?.deck, deck.hooks), history, ...groups.slice(0, -1)], right, { edge: [end.edge], more: () => renderSourceMoreEntries(editor(), end.saveSpelling, end.saveTyping, end.saveSelectionPopup) });
  };

  let shownReview = false;
  let current = build(false);
  return {
    element: () => current,
    show: (withReview) => {
      shownReview = withReview;
      const next = build(withReview);
      current.replaceWith(next);
      current = next;
    },
    reset: () => { shownReview = false; return (current = build(false)); },
    /** Draws the bar again as it is, after a button's icon changed. */
    redraw: () => {
      const next = build(shownReview);
      current.replaceWith(next);
      current = next;
    },
  };
}

function sourceActionDeps({ fs, logger, workspace }: TabContext, { projectId, path }: { projectId: string; path: string }, state: SourceTabState): Parameters<typeof createSourceActions>[0] {
  return {
    projectId, path, language: deriveSourceLanguage(path), fs, logger,
    target: () => {
      const { editor, loaded } = state;
      return editor && loaded ? { edits: editor, entry: loaded, noteLinks: editor.noteLinks, codeLinks: editor.codeLinks, outputLinks: editor.outputLinks, citeFromLibrary: editor.citeFromLibrary, ...(state.consult ? { consult: state.consult.choose } : {}) } : undefined;
    },
    openHistory: () => workspace.openTab("history", { projectId }, 1), openSearch: () => { if (state.search) state.search.toggle(); else workspace.openTab("search", { projectId }, 1); },
  };
}

/** Mounts the talk's or poster's workspace beside the editor; `onMounted` gets the function that unmounts it. */
function mountDeckWorkspace(
  context: TabContext, { host, body, opened, file }: { host: HTMLElement; body: HTMLElement; opened: OpenedEditor; file: { projectId: string; path: string } }, onMounted: (stop: () => void) => void,
): void {
  if (!opened.feed) return;
  void mountWorkspaceInTab({ host, body, context, entry: opened.entry, file, editor: opened.editor, subscribe: opened.feed.subscribe, hooks: deckHooks(context, file) })
    .then((workspace) => { if (workspace) onMounted(() => workspace.dispose()); })
    .catch((error: unknown) => void context.logger.error(MODULE, error, { action: "mountWorkspace", ...file }));
}

type OpenedEditor = NonNullable<Awaited<ReturnType<typeof loadEditor>>>;

/** The tab takes over what `loadEditor` opened. */
function adoptEditor(state: SourceTabState, opened: OpenedEditor): void {
  state.editor = opened.editor;
  state.stopTyping = opened.stopTyping;
  state.release = opened.release;
  state.consult = opened.consult;
  state.mode = opened.mode;
  // INVARIANT: a read-only shared file offers the insert actions no target, so none of them edits it outside the share.
  state.loaded = isReadOnly(opened.mode) ? undefined : opened.entry;
}

function disposeSourceTab(state: SourceTabState, body: HTMLElement, stops: Array<() => void>): void {
  state.disposed = true;
  state.stopTyping?.();
  state.search?.dispose();
  state.searchHost?.dispose();
  for (const stop of stops) stop();
  const { editor, release } = state;
  state.release = undefined;
  if (editor) void editor.dispose().then(() => release?.()).then(() => body.remove()); else { void release?.(); body.remove(); }
}

export const mountTab: TabModule["mountTab"] = (host, params, context) => {
  const { logger } = context;
  const projectId = params["projectId"] ?? "";
  const path = params["path"] ?? "";
  // The pane is already the editor's card: the toolbar stays on top, and the body's other children are the editor or its notice.
  const body = host.appendChild(renderElement("div", { class: "ls-workspace-fill ls-source-body" }));
  const state: SourceTabState = { disposed: false, editor: undefined, loaded: undefined, mode: undefined };
  // On the tab's own element, which a retry does not clear, unlike the body.
  const folder = projectFolderOf(context, projectId);
  if (folder !== undefined) state.search = mountFloatingSearch(host, () => connectSearch(context, { id: projectId, folder }, state));
  const { groups, actions, previewToggle, inserts } = sourceToolbarGroups(context, { projectId, path }, state);
  const toolbar = createToolbarSlot(groups, { shared: () => isSharedProject(context, projectId), trailing: () => trailingButtons(context, projectId), edge: previewToggle.button, saveSpelling: (on) => context.prefs.saveSpelling(on), saveTyping: (next) => void editorPrefsOf(context.fs, logger).setTyping(next).catch(() => undefined), saveSelectionPopup: (next) => void editorPrefsOf(context.fs, logger).setSelectionPopup(next).catch(() => undefined) }, () => review, () => state.editor, { path, hooks: deckHooks(context, { projectId, path }) });
  const stopPreviewToggle = previewToggle.follow(() => toolbar.redraw());
  const stopChatToggle = followProjectChat(context, projectId, () => toolbar.redraw());
  // The mode outlives the editor: reopening the tab or a retry starts from it. A mode the editor reports redraws the dropdown.
  const review = createReviewModeState(projectId, logger, () => { if (!state.disposed && state.editor && !isReadOnly(state.mode)) toolbar.show(true); });
  const stopGuard = guardUnsavedEdits(context, { projectId, path }, () => state.editor);
  const open = (retried: boolean): void => {
    void loadEditor(body, context, { projectId, path, retried, inserts }, review, () => state.disposed).then((opened) => {
      if (!opened) return;
      const readOnly = isReadOnly(opened.mode);
      adoptEditor(state, opened);
      if (!readOnly) toolbar.show(true);
      if (!readOnly && opened.feed && readDeckKindOf(path, opened.editor.deck.text())) {
        mountDeckWorkspace(context, { host, body, opened, file: { projectId, path } }, (stop) => { stopWorkspace = stop; });
      } else if (!state.inline && isArticleSource(path, opened.editor.deck.text())) {
        // An article carries the project's PDF beside its code in this tab, as a talk or poster carries its stage.
        const split = mountInlinePreview(host, body, context, projectId);
        state.inline = split;
        const stopFollow = split.follow(() => previewToggle.refresh());
        previewToggle.refresh();
        void context.workspace.closeTabs((id) => id === TAB_KINDS.preview.id({ projectId }));
        stopWorkspace = () => { stopFollow(); split.dispose(); state.inline = undefined; };
      }
      prependNotice(body, opened.mode, { retry: () => void retry(true), useHere: () => void openSharedProjectHere(context, { projectId, path }, opened.mode, () => retry(false)) });
    });
  };
  const retry = async (retried: boolean): Promise<void> => {
    void logger.log("INFO", MODULE, "reopening the shared session of a source tab", { projectId, path, retried });
    const previous = state.editor;
    state.stopTyping?.();
    state.stopTyping = undefined;
    const release = state.release;
    state.editor = state.loaded = state.mode = state.release = state.consult = undefined;
    await previous?.dispose();
    await release?.();
    if (state.disposed) return;
    body.replaceChildren(toolbar.reset());
    open(retried);
  };
  const stopShares = mountOnTakeover(context, () => state, () => void retry(false));
  // A citation the reader writes into this file shows here; overlapping unsaved edits are kept with a warning.
  const stopFileChanges = followProjectFileChanges({ projectId, path }, () => warnFileChangeConflict(path));
  let stopWorkspace = (): void => undefined;
  body.append(toolbar.element());
  open(false);
  return { actions, dispose: () => disposeSourceTab(state, body, [stopGuard, stopShares, stopFileChanges, stopPreviewToggle, stopChatToggle, () => stopWorkspace()]) };
};

/** The toolbar's Insert Table, Insert Image and Insert Symbol, which the editor's click bubble offers too. */
interface SourceInserts { table(): void; image(): void; symbol(): void }

/** The toolbar groups and tab actions of a source tab, the PDF toggle apart and the figure insert placed among them, and the inserts the click bubble shares. */
function sourceToolbarGroups(context: TabContext, file: { projectId: string; path: string }, state: SourceTabState): { groups: ReturnType<typeof splitSourceActions>["toolbar"]; actions: ReturnType<typeof splitSourceActions>["tab"]; previewToggle: ReturnType<typeof createPreviewToggle>; inserts: SourceInserts } {
  const all = createSourceActions(sourceActionDeps(context, file, state));
  const { toolbar: groups, tab: actions } = splitSourceActions(all);
  const runOf = (id: string) => (): void => all.find((action) => action.id === id)?.run();
  const inserts = { table: runOf("insertTable"), image: runOf("insertImage"), symbol: runOf("insertSymbol") };
  // The PDF toggle ends the bar: an open eye while the preview tab is open, which closes it; a closed eye opens it.
  const previewToggle = createPreviewToggle(context.workspace, file.projectId, () => state.inline);
  // Insert Figure ends the structure inserts: the notes' figure editor, written as TikZ or pgfplots, or the figure at the cursor.
  groups[1]?.push({ label: "Insert Figure", glyph: "chart", run: () => { void state.editor?.editDrawing(); } });
  return { groups, actions, previewToggle, inserts };
}

/** The PDF toggle's button, whose icon follows whether the preview shows: the article's own split when the tab has one, else the project's preview tab; `follow` redraws on every change. */
function createPreviewToggle(workspace: TabContext["workspace"], projectId: string, inline: () => InlinePreview | undefined): { button: SourceToolbarButton; follow(redraw: () => void): () => void; refresh(): void } {
  const previewId = TAB_KINDS.preview.id({ projectId });
  const isOpen = (): boolean => inline()?.shown() ?? workspace.tabs().some((tab) => tab.id === previewId);
  const button: SourceToolbarButton = { label: "", glyph: "eye", run: () => {
    const split = inline();
    if (split) split.toggle();
    else if (isOpen()) void workspace.closeTabs((id) => id === previewId); else workspace.openTab("preview", { projectId }, 1);
  } };
  const update = (): boolean => {
    const [glyph, label] = isOpen() ? ["eye", "Hide PDF Preview"] as const : ["eye-off", "Show PDF Preview"] as const;
    const changed = button.glyph !== glyph;
    Object.assign(button, { glyph, label });
    return changed;
  };
  update();
  let redrawn = (): void => undefined;
  return {
    button,
    follow: (redraw) => { redrawn = redraw; return workspace.onDidChangeTabs(() => { if (update()) redraw(); }); },
    refresh: () => { if (update()) redrawn(); },
  };
}

/** The project folder of the open project the tab belongs to; undefined while it is not the open, ready one. */
export function projectFolderOf({ project }: TabContext, projectId: string): string | undefined {
  const open = project().session.current();
  return open?.kind === "ready" && open.settings.id === projectId ? open.folder : undefined;
}

/** Starts the search's host side in the page, as the search tab does; an opened match shows in this project's source tab. */
function connectSearch({ fs, logger, workspace }: TabContext, project: { id: string; folder: string }, state: SourceTabState): SearchTransport {
  const { ui, host: endpoint } = createLoopbackTransport<SearchToHost, HostToSearch>();
  const openMatch = (path: string, line: number): void => {
    workspace.openTab("source", { projectId: project.id, path }, 0);
    showInOpenEditor(project.id, path, line);
  };
  state.searchHost = mountSearchHost({ fs, logger, endpoint, project, openMatch });
  return ui;
}

const isSharedProject = (context: TabContext, projectId: string): boolean => findSharedProject(context.project().sharing, projectId) !== undefined;

/** The right end of the editor's toolbar: the Project chat icon while the project is shared (D2), then Share as in Overleaf's header while the page offers project sharing. */
function trailingButtons(context: TabContext, projectId: string): SourceToolbarButton[] {
  if (!projectId) return [];
  const shared = isSharedProject(context, projectId);
  const chat: SourceToolbarButton[] = shared ? [{ label: "Project chat", glyph: "message", run: () => context.toggleProjectChat() }] : [];
  return [...chat, ...shareButtons(context, projectId)];
}

/** Redraws the toolbar when the project is shared or left, so the chat icon follows without a reload. */
function followProjectChat(context: TabContext, projectId: string, redraw: () => void): () => void {
  let shared = isSharedProject(context, projectId);
  return context.project().sharing.onProjectsChange(() => {
    const now = isSharedProject(context, projectId);
    if (now !== shared) { shared = now; redraw(); }
  });
}

/** Share, while the page offers project sharing. */
function shareButtons({ sharing, project }: TabContext, projectId: string): SourceToolbarButton[] {
  if (!sharing.offers().projects) return [];
  // Sharing names a project by its folder, the tab by its settings id.
  const run = (): void => {
    const open = project().session.current();
    if (open?.kind === "ready" && open.settings.id === projectId) void runShareProjectDialog(sharing, open.folder);
  };
  return [{ label: "Share", glyph: "users", primary: true, run }];
}

/** Present opens the talk's presenter here and its audience in a second browser tab; Real size opens the poster's preview. */
function deckHooks(context: TabContext, deck: { projectId: string; path: string }): DeckToolHooks {
  return {
    present: () => {
      context.workspace.openTab("deck", { ...deck, view: "presenter" });
      openDeckAudienceTab(deck).catch((error: unknown) => void context.logger.error(MODULE, error, { action: "openAudience", ...deck }));
    },
    posterPreview: () => context.workspace.openTab("deck", { ...deck, view: "poster" }),
  };
}
