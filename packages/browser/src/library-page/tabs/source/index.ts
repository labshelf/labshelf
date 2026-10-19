// Shows a project source file in the lazily loaded source editor, reading and writing it in the library folder.
import { fileText, listProjectFiles, posixPathOps, type ILogger, type LibraryFileSystem, type ProjectEntry } from "@labshelf/core";
import { el, toast } from "@labshelf/core/dom";
import { listAllRecords } from "../../../storage";
import { findProject } from "../../projects-data";
import { recordProjectEdit } from "../../review";
import type { PageShares } from "../../editor/collab";
import { sourceLanguageOf } from "../../editor/insert";
import { sourceActions } from "./actions";
import type { SourceEditor, SourceEditorDeps, SourceFileAccess } from "../../editor/index.js";
import type { TabModule } from "../types";

const MODULE = "tabs.source";

function projectFiles(fs: LibraryFileSystem, entry: ProjectEntry): SourceFileAccess {
  const full = (path: string): string => posixPathOps.join(entry.folder, path);
  return {
    list: () => listProjectFiles({ fs, paths: posixPathOps }, entry.folder),
    read: (path) => fs.readText(full(path)),
    write: (path, text) => fs.writeText(full(path), text),
  };
}

/** The file's shared text when the project has a share; undefined for a local project or when the share cannot be joined (the file is then edited locally). */
async function sharedText(shares: PageShares, entry: ProjectEntry, path: string, logger: ILogger): Promise<SourceEditorDeps["collab"]> {
  if (entry.kind !== "ready" || entry.settings.shared === undefined) return undefined;
  const projectId = entry.settings.id;
  try {
    await shares.connect(projectId, entry.settings.shared, entry.folder);
    const active = shares.active(projectId);
    if (!active) throw new Error(`The share of project ${projectId} is not connected`);
    return { text: fileText(active.session.openDoc(path)), presence: active.presence, name: shares.name() };
  } catch (error) {
    void logger.error(MODULE, error, { action: "joinSharedSession", projectId, path });
    toast("Could not join the shared session; editing this file locally.", "error");
    return undefined;
  }
}

export const mountTab: TabModule["mountTab"] = (host, params, { fs, logger, tab, workspace, project }) => {
  const { session, helperProject, comments, shares } = project();
  const projectId = params["projectId"] ?? "";
  const path = params["path"] ?? "";
  const body = host.appendChild(el("div", { class: "ls-workspace-fill" }));
  const loading = body.appendChild(el("p", { class: "ls-workspace-placeholder" }, `Loading ${path}…`));
  let disposed = false;
  let editor: SourceEditor | undefined;
  let loaded: ProjectEntry | undefined;
  // PLATFORM: pagehide is the last event a closing page reliably gets; the write is best effort once it has started.
  const flushOnLeave = (): void => { void editor?.flush(); };
  window.addEventListener("pagehide", flushOnLeave);
  window.addEventListener("beforeunload", flushOnLeave);
  tab.onBeforeClose(async () => {
    if (!editor || (await editor.flush())) return true;
    void logger.log("WARN", MODULE, "kept the tab open: the file could not be saved", { projectId, path });
    toast(`Could not save ${path}. The tab stays open so no edit is lost.`, "error");
    return false;
  });
  void Promise.all([import("../../editor/index.js"), findProject(fs, logger, session.current(), projectId)])
    .then(async ([module, entry]) => {
      if (disposed) return;
      const collab = await sharedText(shares, entry, path, logger);
      if (disposed) return;
      const mounted = await module.mountSourceEditor(body, {
        projectId, path, files: projectFiles(fs, entry), papers: listAllRecords,
        helper: helperProject.editorPort(projectId), problems: helperProject.problems.subscribe,
        openTab: workspace.openTab, logger, onDirty: tab.setDirty,
        ...(collab ? { collab } : {}),
        onSaved: () => void recordProjectEdit({ fs, logger }, { id: projectId, folder: entry.folder }),
        comments: {
          subscribe: comments.commentAnchorsFor(projectId, path).subscribe,
          add: (range, text) => comments.addComment(projectId, path, range, text),
          open: () => workspace.openTab("comments", { projectId }, 1),
        },
      });
      loading.remove();
      if (disposed) void mounted.dispose(); else { editor = mounted; loaded = entry; }
    })
    .catch((error: unknown) => {
      loading.textContent = `Could not open ${path}.`;
      void logger.error(MODULE, error, { action: "openSource", projectId, path });
    });
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
      window.removeEventListener("pagehide", flushOnLeave);
      window.removeEventListener("beforeunload", flushOnLeave);
      if (editor) void editor.dispose().then(() => body.remove()); else body.remove();
    },
  };
};
