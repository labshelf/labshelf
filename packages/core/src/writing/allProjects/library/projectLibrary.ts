// Implements the All projects page's storage port over the writing projects of a library, for any host.
import type { ProjectEntry, ProjectSettingsPatch } from "../../project/index.js";
import type { ProjectPaneContent, ProjectLibraryPort, ProjectRow } from "../index.js";
import { createProjectPaneSource } from "./projectDetailPaneSource.js";
import { createProjectHostActions } from "./projectHostActions.js";
import type { ProjectLibraryDeps, ReadyProject } from "./projectLibraryDeps.js";
import { deriveProjectRow } from "./projectRows.js";

export function createProjectLibrary(deps: ProjectLibraryDeps): ProjectLibraryPort {
  const { host, projects, session } = deps;
  const find = (id: string): ProjectEntry => findEntry(deps, id);
  const findReady = (id: string): ReadyProject => findReadyEntry(deps, id);
  const open = (id: string): Promise<void> => host.openProject(find(id));
  const openFile = async (id: string, file: string): Promise<void> => {
    const entry = findReady(id);
    if (!host.isOpen(entry)) { await host.openProject(entry); }
    await host.openFile(entry, file);
  };
  const edit = async (id: string, patch: ProjectSettingsPatch): Promise<void> => {
    await projects.update(findReady(id).folder, patch);
    await projects.reload();
  };

  return {
    ...createRowsPort(deps),
    ...createProjectHostActions({ ...deps, findReady, openFile, edit }),
    openLabel: host.openLabel,
    commands: host.commands,
    newKinds: host.newKinds,
    open,
    create: host.createProject,
    rename: (id, title) => edit(id, { title: title === findReady(id).settings.id ? undefined : title }),
    duplicate: (id, title) => host.duplicate(findReady(id), title),
    move: (id, folder) => edit(id, { folder }),
    setArchived: (id, archived) => edit(id, { archived: archived || undefined }),
    setTrashed: (id, trashed) => edit(id, { trashed: trashed ? new Date().toISOString() : undefined }),
    async deleteForever(id) {
      const entry = find(id);
      const current = session();
      if (!current) { throw new Error("open a library before deleting a project"); }
      if (host.isOpen(entry)) { throw new Error("close the project before deleting it"); }
      await deps.data.deleteProjectForever(current.root, entry.folder);
      await current.logger.log("INFO", "writing.allProjects", "project deleted forever", { folder: entry.folder, location: entry.location });
      await projects.reload();
    },
    runCommand: (id, command) => host.runCommand(command, find(id)),
    files: (id) => deps.data.listProjectFiles(findReady(id).folder),
    openFile,
  };
}

function findEntry({ projects }: ProjectLibraryDeps, id: string): ProjectEntry {
  const entry = projects.find(id);
  if (!entry) { throw new Error(`project ${id} is not in the library`); }
  return entry;
}

function findReadyEntry(deps: ProjectLibraryDeps, id: string): ReadyProject {
  const entry = findEntry(deps, id);
  if (entry.kind !== "ready") { throw new Error(`project ${id} cannot be read: ${entry.reason}`); }
  return entry;
}

function createRowsPort(deps: ProjectLibraryDeps): Pick<ProjectLibraryPort, "list" | "detail" | "onDidChange"> {
  const { data, paths, projects, host } = deps;
  const details = createProjectPaneSource(deps);
  // Reading modification times walks each project's files, so a time is kept until the host reports a change.
  const modifiedTimes = new Map<string, Promise<number | undefined>>();
  const modified = (folder: string): Promise<number | undefined> => {
    let time = modifiedTimes.get(folder);
    if (!time) { time = data.lastModified(folder); modifiedTimes.set(folder, time); }
    return time;
  };
  return {
    async list(): Promise<ProjectRow[]> {
      return Promise.all(projects.list().map(async (entry) => {
        const time = await modified(entry.folder);
        if (entry.kind !== "ready") { return deriveProjectRow(paths, entry, time); }
        const [build, cites] = await Promise.all([details.build(entry), details.cites(entry, time)]);
        return deriveProjectRow(paths, entry, time, { build, cites });
      }));
    },
    detail: (id): Promise<ProjectPaneContent> => details.detail(findReadyEntry(deps, id)),
    onDidChange: (listener) => host.onChange(() => { modifiedTimes.clear(); listener(); }),
  };
}
