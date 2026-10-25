// Composes the core All projects library with the VS Code editor, build state and project commands.
import * as vscode from "vscode";
import {
  createProjectLibrary as createCoreLibrary,
  type ILogger,
  type NewProjectKind,
  type PaperRecord,
  type PdfjsLoader,
  type ProjectEntry,
  type ProjectHostFunctions,
  type ProjectLibraryPort,
  type ProjectMenuCommand,
} from "@labshelf/core";
import type { BuildOutcomes } from "../build/index.js";
import { duplicateProject } from "../index.js";
import { builtPdf, rawLogFile, type RootBuilds } from "../preview/index.js";
import { OPEN_PROJECT_COMMAND, type ProjectSession, type WritingHost, type WritingProjects } from "../session/index.js";
import type { SidebarProjectsSource } from "../sidebar/index.js";
import { PROJECT_COMMANDS, isSidebarProjectCommand } from "../../libraryUi/index.js";

const OPEN = "labshelf.writing.openProject";
const EXTERNAL_ONLY = "labshelf.writing.removeProject";

function projectMenuCommands(): ProjectMenuCommand[] {
  return PROJECT_COMMANDS.filter((c) => c.command !== OPEN).map((c) => ({
    command: c.command, label: c.label, group: c.group, ...(c.command === EXTERNAL_ONLY ? { externalOnly: true } : {}),
  }));
}

async function runProjectCommand(command: string, entry: ProjectEntry): Promise<void> {
  if (!isSidebarProjectCommand(command)) { throw new Error(`${command} is not a project command`); }
  await vscode.commands.executeCommand(command, entry);
}

export interface VscodeProjectLibraryDeps {
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

const SHOW_PREVIEW_COMMAND = "labshelf.writing.showPreview";

const CREATE_COMMANDS: Record<NewProjectKind, string> = {
  blank: "labshelf.writing.newBlankProject",
  template: "labshelf.templates.open",
  folder: "labshelf.writing.addExistingFolder",
};

export function createProjectLibrary(deps: VscodeProjectLibraryDeps): ProjectLibraryPort {
  const { host, projects, source, outcomes, builds } = deps;
  return createCoreLibrary({
    data: projects.data, fs: projects.fs, paths: projects.paths, logger: deps.logger,
    session: () => host.current(),
    // Arrow wrappers keep `this` on the class instances.
    projects: { find: (folder) => source.find(folder), list: () => source.list(), update: (folder, patch) => source.update(folder, patch), reload: () => projects.reload() },
    outcomes, builds, listPapers: deps.listPapers, pdfjs: deps.pdfjs,
    locate: {
      pdf: (project) => builtPdf(projects, project, project.main),
      rawLog: (project, root) => rawLogFile(projects, project, root),
    },
    host: createHostFunctions(deps),
  });
}

function createHostFunctions(deps: VscodeProjectLibraryDeps): ProjectHostFunctions {
  const { projects, source, session } = deps;
  const openProject = async (entry: ProjectEntry): Promise<void> => { await vscode.commands.executeCommand(OPEN_PROJECT_COMMAND, entry); };
  return {
    openProject,
    createProject: async (kind) => { await vscode.commands.executeCommand(CREATE_COMMANDS[kind]); },
    openFile: async (entry, file) => {
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(projects.paths.join(entry.folder, ...file.split("/"))));
    },
    build: async (entry, root) => { await deps.recompile(entry.folder, root); },
    preview: async (entry) => {
      await openProject(entry);
      await vscode.commands.executeCommand(SHOW_PREVIEW_COMMAND);
    },
    openLog: async (path) => { await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(path)); },
    duplicate: (entry, title) => duplicateProject({ host: deps.host, projects }, entry, title),
    runCommand: runProjectCommand,
    commands: () => projectMenuCommands(),
    newKinds: () => ["blank", "template", "folder"],
    openLabel: () => "Open in VS Code",
    isOpen: (entry) => session.project?.folder === entry.folder,
    onChange(listener) {
      const subscriptions = [source.onDidChange(listener), deps.outcomes.onDidChange(listener), deps.onDidChangeRootBuild(listener)];
      return () => subscriptions.forEach((subscription) => subscription.dispose());
    },
  };
}
