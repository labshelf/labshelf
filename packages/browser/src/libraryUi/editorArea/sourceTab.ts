// Shows a project source file in the lazily loaded source editor: a local file on disk, a shared file in its share's text.
import {
  PaperNotesStore, createProjectNotesStore, derivePapersByCiteKey, formatError, listProjectCiteKeys, listProjectFiles, posixPathOps,
  type ILogger, type LibraryFileSystem, type NoteInsertSource, type ProjectEntry,
} from "@labshelf/core";
import { renderElement, showToast } from "@labshelf/core/dom";
import { createPaperNotesPort, createProjectNoteFiles, listCachedPaperRecords } from "../../storage";
import {
  addProjectUpdateEvent, createSourceActions, deriveSourceLanguage, findProject, loadSourceEditor, mountOnTakeover, openSharedProjectHere, readSourceFileMode, renderObservingNotice, renderUnresolvedNotice,
  type SourceEditor, type SourceEditorDeps, type SourceFileAccess, type SourceFileMode,
} from "../../writing";
import type { TabContext, TabModule } from "./tabKinds";

const MODULE = "tabs.source";

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
function editorDeps({ fs, logger, tab, workspace, project, selection, prefs }: TabContext, entry: ProjectEntry, file: { projectId: string; path: string }, mode: SourceFileMode): SourceEditorDeps {
  const { helperProject, comments } = project();
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
    }),
    onSaved: () => void addProjectUpdateEvent({ fs, logger }, { id: projectId, folder: entry.folder }),
  };
}

/** Mounts the file's editor in `body`; undefined when the tab closed first or the file could not be opened, which the body then says. */
async function loadEditor(
  body: HTMLElement, context: TabContext, file: { projectId: string; path: string; retried: boolean }, disposed: () => boolean,
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
    const editor = await mountSourceEditor(body, editorDeps(context, entry, { projectId, path }, mode));
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

export const mountTab: TabModule["mountTab"] = (host, params, context) => {
  const { fs, logger, workspace } = context;
  const projectId = params["projectId"] ?? "";
  const path = params["path"] ?? "";
  const body = host.appendChild(renderElement("div", { class: "ls-workspace-fill" }));
  let disposed = false;
  let editor: SourceEditor | undefined;
  let loaded: ProjectEntry | undefined;
  let mode: SourceFileMode | undefined;
  const stopGuard = guardUnsavedEdits(context, { projectId, path }, () => editor);
  const open = (retried: boolean): void => {
    void loadEditor(body, context, { projectId, path, retried }, () => disposed).then((opened) => {
      if (!opened) return;
      editor = opened.editor;
      mode = opened.mode;
      const readOnly = mode.kind === "unresolved" || mode.kind === "observing";
      // INVARIANT: a read-only shared file offers the insert actions no target, so none of them edits it outside the share.
      loaded = readOnly ? undefined : opened.entry;
      body.classList.toggle("ls-source-unresolved", readOnly);
      prependNotice(body, mode, { retry: () => void retry(true), useHere: () => void openSharedProjectHere(context, { projectId, path }, opened.mode, () => retry(false)) });
    });
  };
  const retry = async (retried: boolean): Promise<void> => {
    void logger.log("INFO", MODULE, "reopening the shared session of a source tab", { projectId, path, retried });
    const previous = editor;
    editor = loaded = mode = undefined;
    await previous?.dispose();
    if (disposed) return;
    body.replaceChildren();
    body.classList.remove("ls-source-unresolved");
    open(retried);
  };
  const stopShares = mountOnTakeover(context, () => ({ loaded, mode, disposed }), () => void retry(false));
  open(false);
  const actions = createSourceActions({
    projectId, path, language: deriveSourceLanguage(path), fs, logger,
    target: () => (editor && loaded ? { edits: editor, flush: editor.flush, entry: loaded, noteLinks: editor.noteLinks } : undefined),
    openHistory: () => workspace.openTab("history", { projectId }, 1), openSearch: () => workspace.openTab("search", { projectId }, 1),
    papers: listCachedPaperRecords,
  });
  return {
    actions,
    dispose: () => {
      disposed = true;
      stopGuard(); stopShares();
      if (editor) void editor.dispose().then(() => body.remove()); else body.remove();
    },
  };
};
