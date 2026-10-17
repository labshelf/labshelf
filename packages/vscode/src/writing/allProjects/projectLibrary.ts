// Implements the All projects page's storage port over the writing projects of the open library.
import * as path from "node:path";
import * as vscode from "vscode";
import type { ILogger, NewProjectKind, ProjectEntry, ProjectLibraryPort, ProjectRow, ProjectSettingsPatch } from "@labshelf/core";
import { duplicateProject } from "../index.js";
import { OPEN_PROJECT_COMMAND, type ProjectSession, type WritingHost, type WritingProjects } from "../session/index.js";
import type { SidebarProjectsSource } from "../sidebar/index.js";
import { projectMenuCommands, runProjectCommand } from "./projectCommands.js";
import { toProjectRow } from "./projectRows.js";

export interface ProjectLibraryDeps {
  host: WritingHost;
  projects: WritingProjects;
  /** The project open in the window; it cannot be deleted. */
  session: Pick<ProjectSession, "project">;
  source: Pick<SidebarProjectsSource, "rows" | "find" | "list" | "update" | "onDidChange">;
}

const CREATE_COMMANDS: Record<NewProjectKind, string> = {
  blank: "labshelf.writing.newBlankProject",
  template: "labshelf.templates.open",
  folder: "labshelf.writing.addExistingFolder",
};

type ReadyEntry = Extract<ProjectEntry, { kind: "ready" }>;

export function createProjectLibrary(deps: ProjectLibraryDeps): ProjectLibraryPort {
  const { host, projects, session: openSession, source } = deps;
  // Reading modification times walks each project's files, so a time is kept until the project list changes.
  const modifiedTimes = new Map<string, Promise<number | undefined>>();

  const modified = (folder: string): Promise<number | undefined> => {
    let time = modifiedTimes.get(folder);
    if (!time) { time = projects.data.lastModified(folder); modifiedTimes.set(folder, time); }
    return time;
  };
  const find = (id: string): ProjectEntry => {
    const entry = source.find(id);
    if (!entry) { throw new Error(`project ${id} is not in the library`); }
    return entry;
  };
  const findReady = (id: string): ReadyEntry => {
    const entry = find(id);
    if (entry.kind !== "ready") { throw new Error(`project ${id} cannot be read: ${entry.reason}`); }
    return entry;
  };
  const edit = async (id: string, patch: ProjectSettingsPatch): Promise<void> => {
    await source.update(findReady(id).folder, patch);
    await projects.reload();
  };

  return {
    async list(): Promise<ProjectRow[]> {
      const counts = new Map((await source.rows()).map((row) => [row.id, row.count]));
      return Promise.all(source.list().map(async (entry) => toProjectRow(entry, counts.get(entry.folder), await modified(entry.folder))));
    },
    onDidChange(listener) {
      const subscription = source.onDidChange(() => { modifiedTimes.clear(); listener(); });
      return () => subscription.dispose();
    },
    commands: projectMenuCommands,
    open: async (id) => { await vscode.commands.executeCommand(OPEN_PROJECT_COMMAND, find(id)); },
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
    async openFile(id, file) {
      const entry = findReady(id);
      if (openSession.project?.folder !== entry.folder) { await vscode.commands.executeCommand(OPEN_PROJECT_COMMAND, entry); }
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(path.join(entry.folder, ...file.split("/"))));
    },
  };
}

const log = (logger: ILogger, message: string, context: Record<string, unknown>): Promise<void> =>
  logger.log("INFO", "writing.allProjects", message, context);
