// Keeps the All projects page's expanded project, its file listings and open folders, and posts the log and Add file requests, asking the host for a fresh listing on every expand.
import { inputBox } from "../../../../ui/dom/index.js";
import type { ProjectDetail } from "../../projectDetail.js";
import type { AllProjectsToHost, HostToAllProjects } from "../../protocol/index.js";
import type { ProjectRow } from "../../projectRow.js";
import { openFolderKey, type ProjectFiles, type ProjectTrayFrame, type ProjectTrayHandlers } from "./projectTray.js";

export interface ProjectExpansionDeps {
  post: (message: AllProjectsToHost) => void;
  rowById: (id: string) => ProjectRow | undefined;
  select: (id: string) => void;
  detailOf: (id: string) => ProjectDetail | undefined;
  render: () => void;
}

export interface ProjectExpansion {
  frame(): ProjectTrayFrame;
  handlers: ProjectTrayHandlers & { onToggle: (id: string) => void };
  receive(message: Extract<HostToAllProjects, { type: "files" }>): void;
  /** Collapses the expanded project when it is no longer shown. */
  keepShown(shown: ReadonlySet<string>): void;
}

export function createProjectExpansion(deps: ProjectExpansionDeps): ProjectExpansion {
  let expanded: string | null = null;
  const files: Record<string, ProjectFiles> = {};
  const openFolders = new Set<string>();
  return {
    frame: () => ({ expanded, files: { ...files }, detail: expanded ? deps.detailOf(expanded) : undefined, openFolders }),
    handlers: {
      onToggle(id) {
        expanded = expanded === id ? null : id;
        if (expanded) { files[id] = { status: "loading" }; deps.post({ type: "files", id }); }
        deps.render();
      },
      onOpenFile(id, path) {
        deps.select(id);
        // Trashed projects only list their files; opening one would bring the project back into use.
        if (deps.rowById(id)?.place !== "trash") deps.post({ type: "openFile", id, path });
      },
      onToggleFolder(id, path) {
        const key = openFolderKey(id, path);
        if (!openFolders.delete(key)) openFolders.add(key);
        deps.select(id);
      },
      onOpenLog(id) {
        deps.post({ type: "openLog", id });
      },
      onAddFile(id) {
        void inputBox({ title: "Add file", prompt: "File path in the project, e.g. sections/related.tex" }).then((path) => {
          if (path) deps.post({ type: "createFile", id, path });
        });
      },
    },
    receive(message) {
      files[message.id] = "error" in message ? { status: "failed", message: message.error } : { status: "ready", files: message.files };
      if (message.id === expanded) deps.render();
    },
    keepShown(shown) {
      if (expanded && !shown.has(expanded)) expanded = null;
    },
  };
}
