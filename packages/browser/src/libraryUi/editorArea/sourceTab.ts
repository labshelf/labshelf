// Shows a project source file in the lazily loaded source editor: a local file on disk, a shared file in its share's text.
import {
  PaperNotesStore, createLoopbackTransport, createProjectNotesStore, derivePapersByCiteKey, formatError, listProjectCiteKeys, listProjectFiles, posixPathOps,
  type HostToSearch, type ILogger, type LibraryFileSystem, type NoteInsertSource, type ProjectEntry, type SearchToHost, type SearchTransport,
} from "@labshelf/core";
import { mountFloatingSearch, renderElement, runShareProjectDialog, showToast, type FloatingSearch } from "@labshelf/core/dom";
import { renderSourceToolbar, reviewModeDropdown, type ReviewMode, type SourceEditor, type SourceEditorDeps, type SourceFileAccess, type SourceToolbarButton } from "@labshelf/core/sourceEditor";
import { createPaperNotesPort, createProjectNoteFiles, listCachedPaperRecords } from "../../storage";
import {
  addProjectUpdateEvent, createSourceActions, deriveSourceLanguage, findProject, loadSourceEditor, mountOnTakeover, mountSearchHost, openSharedProjectHere, readSourceFileMode, renderObservingNotice, renderUnresolvedNotice, showInOpenEditor, splitSourceActions,
  type SourceFileMode,
} from "../../writing";
import { TAB_KINDS, type TabContext, type TabModule } from "./tabKinds";

const MODULE = "tabs.source";

/** The review mode a project's source tabs open in, kept per project so it survives reopening a tab; Editing until the user picks Reviewing. */
interface ReviewModeState {
  get(): ReviewMode;
  /** Stores the mode; true when it differs from the stored one. */
  set(mode: ReviewMode): boolean;
  /** Runs when the editor reports a mode picked on its side. */
  onMode(mode: ReviewMode): void;
}

function createReviewModeState(projectId: string, logger: ILogger, changed: () => void): ReviewModeState {
  const key = `labshelf.reviewMode.${projectId}`;
  let current: ReviewMode = "editing";
  // PLATFORM: localStorage throws when the browser blocks storage; the mode then lasts for this tab only.
  try { if (window.localStorage.getItem(key) === "reviewing") current = "reviewing"; } catch (error) { void logger.error(MODULE, error, { action: "readReviewMode", projectId }); }
  const set = (mode: ReviewMode): boolean => {
    if (mode === current) return false;
    current = mode;
    try { window.localStorage.setItem(key, mode); } catch (error) { void logger.error(MODULE, error, { action: "storeReviewMode", projectId }); }
    return true;
  };
  return { get: () => current, set, onMode: (mode) => { if (set(mode)) changed(); } };
}

function projectFiles(fs: LibraryFileSystem, entry: ProjectEntry): SourceFileAccess {
  const full = (path: string): string => posixPathOps.join(entry.folder, path);
  return {
    list: () => listProjectFiles({ fs, paths: posixPathOps }, entry.folder),
    read: (path) => fs.readText(full(path)),
    write: (path, text) => fs.writeText(full(path), text),
  };
}

/** The notes "Insert from note" reads: the project's notes and the notes of the papers its sources cite; a reader that fails logs and answers empty, so one bad note never empties the picker. */
function noteLinkSource(fs: LibraryFileSystem, logger: ILogger, entry: ProjectEntry & { kind: "ready" }): NoteInsertSource {
  const store = createProjectNotesStore(createProjectNoteFiles(fs, async () => entry.folder), logger);
  const paperNotes = createPaperNotesPort(fs);
  const projectId = entry.settings.id;
  const safe = async <T>(action: string, fallback: T, read: () => Promise<T>): Promise<T> => {
    try {
      return await read();
    } catch (error) {
      void logger.error(MODULE, error, { action, projectId, message: formatError(error) });
      return fallback;
    }
  };
  return {
    listProjectNotes: () => safe("listProjectNotes", [], () => store.list(projectId)),
    readProjectNote: (path) => safe("readProjectNote", undefined, async () => (await store.read(projectId, path)) ?? undefined),
    listCitedPaperIds: () => safe("listCitedPaperIds", [], async () => {
      const keys = await listProjectCiteKeys({ fs, paths: posixPathOps }, entry.folder, entry.settings.format);
      const byKey = derivePapersByCiteKey(await listCachedPaperRecords());
      return [...new Set(keys.flatMap((key) => byKey.get(key)?.id ?? []))];
    }),
    readPaperNote: (paperId) => safe("readPaperNote", undefined, async () => (await paperNotes.read(paperId)) ?? undefined),
  };
}

/** What the editor of a project file gets; a shared file this tab does not run opens read-only and takes no comments, which would land in comments.qmd and never reach the share. */
function editorDeps({ fs, logger, tab, workspace, project, selection, prefs }: TabContext, entry: ProjectEntry, file: { projectId: string; path: string }, mode: SourceFileMode, review: ReviewModeState,
): SourceEditorDeps {
  const { helperProject, comments, sharing, suggestions } = project();
  const { projectId, path } = file;
  const readOnly = mode.kind === "unresolved" || mode.kind === "observing";
  return {
    projectId, path, files: projectFiles(fs, entry), papers: listCachedPaperRecords,
    helper: helperProject.editorPort(projectId), problems: helperProject.problems.subscribe,
    openTab: workspace.openTab, logger, onDirty: tab.setDirty,
    notes: new PaperNotesStore(createPaperNotesPort(fs), { logger }),
    // Shows the paper in the Details pane on its Notes tab, the pane the library page lists a paper's notes in.
    openNotes: (paperId) => {
      prefs.save({ detailTab: "notes" });
      selection.publish("source-notes", { kind: "paper", ids: [paperId] });
      selection.activate("source-notes");
    },
    ...(mode.kind === "shared" ? { collab: mode.collab } : {}),
    ...(!readOnly && entry.kind === "ready" ? { noteLinks: noteLinkSource(fs, logger, entry) } : {}),
    ...(readOnly ? { readOnly: true } : {
      comments: {
        subscribe: comments.commentAnchorsFor(projectId, path).subscribe,
        add: (range, text) => comments.addComment(projectId, path, range, text),
        open: () => workspace.openTab("comments", { projectId }, 1),
      },
      review: { author: () => sharing.shares.name(), mode: review.get(), suggestions: suggestions.suggestionsFor(projectId, path), onMode: review.onMode },
    }),
    onSaved: () => void addProjectUpdateEvent({ fs, logger }, { id: projectId, folder: entry.folder }),
  };
}

/** Mounts the file's editor in `body`; undefined when the tab closed first or the file could not be opened, which the body then says. */
async function loadEditor(
  body: HTMLElement, context: TabContext, file: { projectId: string; path: string; retried: boolean }, review: ReviewModeState, disposed: () => boolean,
): Promise<{ editor: SourceEditor; entry: ProjectEntry; mode: SourceFileMode } | undefined> {
  const { fs, logger, project } = context;
  const { projectId, path, retried } = file;
  const { session, sharing } = project();
  const loading = body.appendChild(renderElement("p", { class: "ls-workspace-placeholder" }, `Loading ${path}…`));
  try {
    const loadingModule = loadSourceEditor();
    const entry = await findProject(fs, logger, session.current(), projectId);
    const { mountSourceEditor } = await loadingModule;
    if (disposed()) return undefined;
    const mode = await readSourceFileMode(sharing, entry, path, logger, retried);
    if (disposed()) return undefined;
    const editor = await mountSourceEditor(body, editorDeps(context, entry, { projectId, path }, mode, review));
    loading.remove();
    if (disposed()) { void editor.dispose(); return undefined; }
    return { editor, entry, mode };
  } catch (error) {
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
  /** The project search floating over the editor; its host side starts on the first open. */
  search?: FloatingSearch;
  searchHost?: { dispose(): void };
}

const isReadOnly = (mode: SourceFileMode | undefined): boolean => mode === undefined || mode.kind === "unresolved" || mode.kind === "observing";

/** The toolbar offers the mode dropdown only while a writable editor is open; `element` is the one on screen. */
/** `trailing` ends the bar beside the review dropdown, shown read-only or not. */
function createToolbarSlot(groups: ReturnType<typeof splitSourceActions>["toolbar"], trailing: SourceToolbarButton[], review: () => ReviewModeState, editor: () => SourceEditor | undefined): {
  element(): HTMLElement; show(withReview: boolean): void; reset(): HTMLElement; redraw(): void;
} {
  const build = (withReview: boolean): HTMLElement => {
    const last = [
      ...(withReview ? [reviewModeDropdown(() => review().get(), (picked) => { review().set(picked); editor()?.setReviewMode(picked); })] : []),
      ...trailing,
    ];
    // The last group is the project's tools (search, PDF, history): it joins the review mode and Share at the right.
    const right = [...groups.slice(-1), ...(last.length > 0 ? [last] : [])];
    return renderSourceToolbar(groups.slice(0, -1), right);
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
      return editor && loaded ? { edits: editor, flush: editor.flush, entry: loaded, noteLinks: editor.noteLinks } : undefined;
    },
    openHistory: () => workspace.openTab("history", { projectId }, 1), openSearch: () => { if (state.search) state.search.toggle(); else workspace.openTab("search", { projectId }, 1); },
    papers: listCachedPaperRecords,
  };
}

function disposeSourceTab(state: SourceTabState, body: HTMLElement, stops: Array<() => void>): void {
  state.disposed = true;
  state.search?.dispose();
  state.searchHost?.dispose();
  for (const stop of stops) stop();
  const { editor } = state;
  if (editor) void editor.dispose().then(() => body.remove()); else body.remove();
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
  const { toolbar: groups, tab: actions } = splitSourceActions(createSourceActions(sourceActionDeps(context, { projectId, path }, state)));
  // The PDF toggle sits between Search and History: an open eye while the preview tab is open, which closes it; a closed eye opens it.
  const previewToggle = createPreviewToggle(context.workspace, projectId);
  // Insert Diagram joins the insert tools before Cite: the notes' drawing editor, written as TikZ, or the diagram at the cursor.
  groups[1]?.splice(-1, 0, { label: "Insert Diagram", glyph: "chart", run: () => { void state.editor?.editDrawing(); } });
  groups.at(-1)?.splice(1, 0, previewToggle.button);
  const toolbar = createToolbarSlot(groups, shareButtons(context, projectId), () => review, () => state.editor);
  const stopPreviewToggle = previewToggle.follow(() => toolbar.redraw());
  // The mode outlives the editor: reopening the tab or a retry starts from it. A mode the editor reports redraws the dropdown.
  const review = createReviewModeState(projectId, logger, () => { if (!state.disposed && state.editor && !isReadOnly(state.mode)) toolbar.show(true); });
  const stopGuard = guardUnsavedEdits(context, { projectId, path }, () => state.editor);
  const open = (retried: boolean): void => {
    void loadEditor(body, context, { projectId, path, retried }, review, () => state.disposed).then((opened) => {
      if (!opened) return;
      const readOnly = isReadOnly(opened.mode);
      state.editor = opened.editor;
      state.mode = opened.mode;
      // INVARIANT: a read-only shared file offers the insert actions no target, so none of them edits it outside the share.
      state.loaded = readOnly ? undefined : opened.entry;
      if (!readOnly) toolbar.show(true);
      prependNotice(body, opened.mode, { retry: () => void retry(true), useHere: () => void openSharedProjectHere(context, { projectId, path }, opened.mode, () => retry(false)) });
    });
  };
  const retry = async (retried: boolean): Promise<void> => {
    void logger.log("INFO", MODULE, "reopening the shared session of a source tab", { projectId, path, retried });
    const previous = state.editor;
    state.editor = state.loaded = state.mode = undefined;
    await previous?.dispose();
    if (state.disposed) return;
    body.replaceChildren(toolbar.reset());
    open(retried);
  };
  const stopShares = mountOnTakeover(context, () => state, () => void retry(false));
  body.append(toolbar.element());
  open(false);
  return { actions, dispose: () => disposeSourceTab(state, body, [stopGuard, stopShares, stopPreviewToggle]) };
};

/** The PDF toggle's button, whose icon follows whether the project's preview tab is open; `follow` redraws on every change. */
function createPreviewToggle(workspace: TabContext["workspace"], projectId: string): { button: SourceToolbarButton; follow(redraw: () => void): () => void } {
  const previewId = TAB_KINDS.preview.id({ projectId });
  const isOpen = (): boolean => workspace.tabs().some((tab) => tab.id === previewId);
  const button: SourceToolbarButton = { label: "", glyph: "eye", run: () => {
    if (isOpen()) void workspace.closeTabs((id) => id === previewId); else workspace.openTab("preview", { projectId }, 1);
  } };
  const update = (): boolean => {
    const [glyph, label] = isOpen() ? ["eye", "Hide PDF Preview"] as const : ["eye-off", "Show PDF Preview"] as const;
    const changed = button.glyph !== glyph;
    Object.assign(button, { glyph, label });
    return changed;
  };
  update();
  return { button, follow: (redraw) => workspace.onDidChangeTabs(() => { if (update()) redraw(); }) };
}

/** The project folder of the open project the tab belongs to; undefined while it is not the open, ready one. */
function projectFolderOf({ project }: TabContext, projectId: string): string | undefined {
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

/** Share, at the right end of the editor's toolbar as in Overleaf's header, while the page offers project sharing. */
function shareButtons({ sharing, project }: TabContext, projectId: string): SourceToolbarButton[] {
  if (!projectId || !sharing.offers().projects) return [];
  // Sharing names a project by its folder, the tab by its settings id.
  const run = (): void => {
    const open = project().session.current();
    if (open?.kind === "ready" && open.settings.id === projectId) void runShareProjectDialog(sharing, open.folder);
  };
  return [{ label: "Share", glyph: "users", primary: true, run }];
}
