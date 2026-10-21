// Shows a project source file in the lazily loaded source editor: a local file on disk, a shared file in its share's text.
import { listProjectFiles, posixPathOps, type LibraryFileSystem, type ProjectEntry } from "@labshelf/core";
import { el, toast } from "@labshelf/core/dom";
import { listAllRecords } from "../../../storage";
import { findProject } from "../../projects-data";
import { recordProjectEdit } from "../../review";
import { sourceLanguageOf } from "../../editor/insert";
import { sourceActions } from "./actions";
import { sourceFileMode } from "./sharedFile";
import { observingNotice, unresolvedNotice } from "./readOnlyNotice";
import type { SourceEditor, SourceEditorDeps, SourceFileAccess } from "../../editor/index.js";
import type { TabContext, TabModule } from "../types";
import type { SourceFileMode } from "./sharedFile";

const MODULE = "tabs.source";

function projectFiles(fs: LibraryFileSystem, entry: ProjectEntry): SourceFileAccess {
  const full = (path: string): string => posixPathOps.join(entry.folder, path);
  return {
    list: () => listProjectFiles({ fs, paths: posixPathOps }, entry.folder),
    read: (path) => fs.readText(full(path)),
    write: (path, text) => fs.writeText(full(path), text),
  };
}

/** What the editor of a project file gets; a shared file this tab does not run opens read-only and takes no comments, which would land in comments.json and never reach the share. */
function editorDeps({ fs, logger, tab, workspace, project }: TabContext, entry: ProjectEntry, file: { projectId: string; path: string }, mode: SourceFileMode): SourceEditorDeps {
  const { helperProject, comments } = project();
  const { projectId, path } = file;
  const readOnly = mode.kind === "unresolved" || mode.kind === "observing";
  return {
    projectId, path, files: projectFiles(fs, entry), papers: listAllRecords,
    helper: helperProject.editorPort(projectId), problems: helperProject.problems.subscribe,
    openTab: workspace.openTab, logger, onDirty: tab.setDirty,
    ...(mode.kind === "shared" ? { collab: mode.collab } : {}),
    ...(readOnly ? { readOnly: true } : {
      comments: {
        subscribe: comments.commentAnchorsFor(projectId, path).subscribe,
        add: (range, text) => comments.addComment(projectId, path, range, text),
        open: () => workspace.openTab("comments", { projectId }, 1),
      },
    }),
    onSaved: () => void recordProjectEdit({ fs, logger }, { id: projectId, folder: entry.folder }),
  };
}

/** Mounts the file's editor in `body`; undefined when the tab closed first or the file could not be opened, which the body then says. */
async function loadEditor(
  body: HTMLElement, context: TabContext, file: { projectId: string; path: string; retried: boolean }, disposed: () => boolean,
): Promise<{ editor: SourceEditor; entry: ProjectEntry; mode: SourceFileMode } | undefined> {
  const { fs, logger, project } = context;
  const { projectId, path, retried } = file;
  const { session, sharing } = project();
  const loading = body.appendChild(el("p", { class: "ls-workspace-placeholder" }, `Loading ${path}…`));
  try {
    const loadingModule = import("../../editor/index.js");
    const entry = await findProject(fs, logger, session.current(), projectId);
    const { mountSourceEditor } = await loadingModule;
    if (disposed()) return undefined;
    const mode = await sourceFileMode(sharing, entry, path, logger, retried);
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
    toast(`Could not save ${path}. The tab stays open so no edit is lost.`, "error");
    return false;
  });
  return () => {
    window.removeEventListener("pagehide", flushOnLeave);
    window.removeEventListener("beforeunload", flushOnLeave);
  };
}

export const mountTab: TabModule["mountTab"] = (host, params, context) => {
  const { fs, logger, workspace, project } = context;
  const projectId = params["projectId"] ?? "";
  const path = params["path"] ?? "";
  const body = host.appendChild(el("div", { class: "ls-workspace-fill" }));
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
      if (mode.kind === "unresolved") body.prepend(unresolvedNotice(() => void retry(true)));
      if (mode.kind === "observing") body.prepend(observingNotice(() => void useHere(opened.mode)));
    });
  };
  const useHere = async (observing: SourceFileMode): Promise<void> => {
    if (observing.kind !== "observing") return;
    void logger.log("INFO", MODULE, "taking a shared project over from another tab", { projectId, path, shareId: observing.shareId });
    // The share's state change remounts this tab once the takeover connects.
    await project().sharing.shares.takeOver(observing.shareId).catch((error: unknown) => {
      void logger.error(MODULE, error, { action: "take a shared project over from another tab", projectId, path, shareId: observing.shareId });
      toast("Could not use the shared project here. Try again, or close the other tab.", "error");
      void retry(false);
    });
  };
  const retry = async (retried: boolean): Promise<void> => {
    void logger.log("INFO", MODULE, "reopening the shared session of a source tab", { projectId, path, retried });
    const previous = editor;
    editor = loaded = undefined;
    mode = undefined;
    await previous?.dispose();
    if (disposed) return;
    body.replaceChildren();
    body.classList.remove("ls-source-unresolved");
    open(retried);
  };
  // A takeover in either direction flips this tab between running the share and observing it, so the editor remounts.
  const stopShares = project().sharing.shares.onChange(() => {
    const shareId = loaded?.kind === "ready" ? loaded.settings.shared : mode?.kind === "observing" ? mode.shareId : undefined;
    if (shareId === undefined || disposed) return;
    const connected = project().sharing.shares.state(shareId)?.kind === "connected";
    if (connected !== (mode?.kind === "shared")) void retry(false);
  });
  open(false);
  const actions = sourceActions({
    projectId, path, language: sourceLanguageOf(path), fs, logger,
    target: () => (editor && loaded ? { edits: editor, flush: editor.flush, entry: loaded } : undefined),
    openHistory: () => workspace.openTab("history", { projectId }, 1),
    openSearch: () => workspace.openTab("search", { projectId }, 1),
    papers: listAllRecords,
  });
  return {
    actions,
    dispose: () => {
      disposed = true;
      stopGuard();
      stopShares();
      if (editor) void editor.dispose().then(() => body.remove()); else body.remove();
    },
  };
};
