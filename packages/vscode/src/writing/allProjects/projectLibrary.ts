// Implements the All projects page's storage port over the writing projects of the open library.
import * as vscode from "vscode";
import type { ILogger, NewProjectKind, PaperRecord, PdfjsLoader, ProjectDetail, ProjectEntry, ProjectLibraryPort, ProjectRow, ProjectSettingsPatch } from "@labshelf/core";
import type { BuildOutcomes } from "../build/index.js";
import { duplicateProject } from "../index.js";
import type { RootBuilds } from "../preview/index.js";
import { OPEN_PROJECT_COMMAND, type ProjectSession, type WritingHost, type WritingProjects } from "../session/index.js";
import type { SidebarProjectsSource } from "../sidebar/index.js";
import { projectMenuCommands, runProjectCommand } from "./projectCommands.js";
import { createProjectDetailSource } from "./projectDetailSource.js";
import { createProjectHostActions } from "./projectHostActions.js";
import { toProjectRow } from "./projectRows.js";

export interface ProjectLibraryDeps {
  host: WritingHost;
  projects: WritingProjects;
  /** The project open in the window; it cannot be deleted. */
  session: Pick<ProjectSession, "project">;
  source: Pick<SidebarProjectsSource, "find" | "list" | "update" | "onDidChange">;
  outcomes: Pick<BuildOutcomes, "last" | "onDidChange">;
  builds: Pick<RootBuilds, "builtRoots" | "problemsOf" | "stateOf">;
  onDidChangeRootBuild: vscode.Event<void>;
  listPapers: () => Promise<PaperRecord[]>;
  logger: ILogger;
  pdfjs: PdfjsLoader;
  /** Saves the editors and builds one root of a project, as Build Project does. */
  recompile: (folder: string, root: string) => Promise<unknown>;
}

const CREATE_COMMANDS: Record<NewProjectKind, string> = {
  blank: "labshelf.writing.newBlankProject",
  template: "labshelf.templates.open",
  folder: "labshelf.writing.addExistingFolder",
};

type ReadyEntry = Extract<ProjectEntry, { kind: "ready" }>;

export function createProjectLibrary(deps: ProjectLibraryDeps): ProjectLibraryPort {
  const { host, projects, session: openSession, source } = deps;
  const find = (id: string): ProjectEntry => findEntry(source, id);
  const findReady = (id: string): ReadyEntry => findReadyEntry(source, id);
  const open = async (id: string): Promise<void> => { await vscode.commands.executeCommand(OPEN_PROJECT_COMMAND, find(id)); };
  const openFile = async (id: string, file: string): Promise<void> => {
    const entry = findReady(id);
    if (openSession.project?.folder !== entry.folder) { await open(id); }
    await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(projects.paths.join(entry.folder, ...file.split("/"))));
  };
  const edit = async (id: string, patch: ProjectSettingsPatch): Promise<void> => {
    await source.update(findReady(id).folder, patch);
    await projects.reload();
  };

  return {
    ...createRowsPort(deps),
    ...createProjectHostActions({ projects, findReady, recompile: deps.recompile, open, openFile, edit }),
    openLabel: () => "Open in VS Code",
    commands: projectMenuCommands,
    open,
    create: async (kind) => { await vscode.commands.executeCommand(CREATE_COMMANDS[kind]); },
    rename: (id, title) => edit(id, { title: title === findReady(id).settings.id ? undefined : title }),
    duplicate: (id, title) => duplicateProject({ host, projects }, findReady(id), title),
    move: (id, folder) => edit(id, { folder }),
    setArchived: (id, archived) => edit(id, { archived: archived || undefined }),
    setTrashed: (id, trashed) => edit(id, { trashed: trashed ? new Date().toISOString() : undefined }),
    async deleteForever(id) {
      const entry = find(id);
      const session = host.current();
      if (!session) { throw new Error("open a library before deleting a project"); }
      if (openSession.project?.folder === entry.folder) { throw new Error("close the project before deleting it"); }
      await projects.data.deleteProjectForever(session.root, entry.folder);
      await log(session.logger, "project deleted forever", { folder: entry.folder, location: entry.location });
      await projects.reload();
    },
    runCommand: (id, command) => runProjectCommand(command, find(id)),
    files: (id) => projects.data.listProjectFiles(findReady(id).folder),
    openFile,
  };
}

function findEntry(source: ProjectLibraryDeps["source"], id: string): ProjectEntry {
  const entry = source.find(id);
  if (!entry) { throw new Error(`project ${id} is not in the library`); }
  return entry;
}

function findReadyEntry(source: ProjectLibraryDeps["source"], id: string): ReadyEntry {
  const entry = findEntry(source, id);
  if (entry.kind !== "ready") { throw new Error(`project ${id} cannot be read: ${entry.reason}`); }
  return entry;
}

function createRowsPort(deps: ProjectLibraryDeps): Pick<ProjectLibraryPort, "list" | "detail" | "onDidChange"> {
  const { projects, source } = deps;
  const details = createProjectDetailSource(deps);
  // Reading modification times walks each project's files, so a time is kept until the project list changes.
  const modifiedTimes = new Map<string, Promise<number | undefined>>();
  const modified = (folder: string): Promise<number | undefined> => {
    let time = modifiedTimes.get(folder);
    if (!time) { time = projects.data.lastModified(folder); modifiedTimes.set(folder, time); }
    return time;
  };
  return {
    async list(): Promise<ProjectRow[]> {
      return Promise.all(source.list().map(async (entry) => {
        const time = await modified(entry.folder);
        if (entry.kind !== "ready") { return toProjectRow(projects.paths, entry, time); }
        const [build, cites] = await Promise.all([details.build(entry), details.cites(entry, time)]);
        return toProjectRow(projects.paths, entry, time, { build, cites });
      }));
    },
    detail: (id): Promise<ProjectDetail> => details.detail(findReadyEntry(source, id)),
    onDidChange(listener) {
      const subscriptions = [
        source.onDidChange(() => { modifiedTimes.clear(); listener(); }),
        deps.outcomes.onDidChange(listener),
        deps.onDidChangeRootBuild(listener),
      ];
      return () => subscriptions.forEach((subscription) => subscription.dispose());
    },
  };
}

const log = (logger: ILogger, message: string, context: Record<string, unknown>): Promise<void> =>
  logger.log("INFO", "writing.allProjects", message, context);
