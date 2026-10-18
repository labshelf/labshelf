// Shows a project source file in the lazily loaded source editor, reading and writing it in the library folder.
import { listProjectFiles, posixPathOps, type ILogger, type LibraryFileSystem, type ProjectEntry } from "@labshelf/core";
import { el, toast } from "@labshelf/core/dom";
import { listAllRecords } from "../../../storage";
import { createBrowserProjectData } from "../../projects-data";
import type { SourceEditor, SourceFileAccess } from "../../editor/index.js";
import type { TabModule } from "../types";

const MODULE = "tabs.source";

const isProject = (entry: ProjectEntry | undefined, projectId: string): entry is ProjectEntry =>
  entry?.kind === "ready" && entry.settings.id === projectId;

/** The open project is the usual answer; a tab restored after a reload finds its project in the library folder. */
async function findProject(fs: LibraryFileSystem, logger: ILogger, open: ProjectEntry | undefined, projectId: string): Promise<ProjectEntry> {
  if (isProject(open, projectId)) return open;
  const entries = await createBrowserProjectData({ fs, logger }).listProjects("");
  const entry = entries.find((candidate) => isProject(candidate, projectId));
  if (!entry) throw new Error(`Project ${projectId} is not in the library folder`);
  return entry;
}

function projectFiles(fs: LibraryFileSystem, entry: ProjectEntry): SourceFileAccess {
  const full = (path: string): string => posixPathOps.join(entry.folder, path);
  return {
    list: () => listProjectFiles({ fs, paths: posixPathOps }, entry.folder),
    read: (path) => fs.readText(full(path)),
    write: (path, text) => fs.writeText(full(path), text),
  };
}

export const mountTab: TabModule["mountTab"] = (host, params, { fs, logger, session, tab, helperProject, workspace }) => {
  const projectId = params["projectId"] ?? "";
  const path = params["path"] ?? "";
  const body = host.appendChild(el("div", { class: "ls-workspace-fill" }));
  const loading = body.appendChild(el("p", { class: "ls-workspace-placeholder" }, `Loading ${path}…`));
  let disposed = false;
  let editor: SourceEditor | undefined;
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
      const mounted = await module.mountSourceEditor(body, {
        projectId, path, files: projectFiles(fs, entry), papers: listAllRecords,
        helper: helperProject.editorPort(projectId), problems: helperProject.problems.subscribe,
        lsp: helperProject.lsp(projectId), openTab: workspace.openTab, logger, onDirty: tab.setDirty,
      });
      loading.remove();
      if (disposed) void mounted.dispose(); else editor = mounted;
    })
    .catch((error: unknown) => {
      loading.textContent = `Could not open ${path}.`;
      void logger.error(MODULE, error, { action: "openSource", projectId, path });
    });
  return {
    dispose: () => {
      disposed = true;
      window.removeEventListener("pagehide", flushOnLeave);
      window.removeEventListener("beforeunload", flushOnLeave);
      if (editor) void editor.dispose().then(() => body.remove()); else body.remove();
    },
  };
};
