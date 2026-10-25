// Creates the open project's views with their commands: Figures as a native tree, Files, Outline and Checklist through the sidebar mirror.
import * as vscode from "vscode";

import type { ILogger, ReadingStatus } from "@labshelf/core";
import type { ArcIcon } from "../../ui/index.js";
import type { BuildOutcomes } from "../build/index.js";
import { registerChecklistView, createSignalsReader } from "../checklist/index.js";
import { OutlineTreeProvider, REVEAL_OUTLINE_COMMAND, registerTypstOutline, showOutline } from "../outline/index.js";
import { ProjectFiguresView, type ProjectFigures } from "../figures/index.js";
import type { BuildPreviews } from "../preview/index.js";
import { ProjectTreeMirror, SidebarProjectsSource, type ProjectTreeSpec } from "../sidebar/index.js";
import type { ProjectReadingLists } from "../readingList/index.js";
import type { ProjectSession, WritingProjects } from "../session/index.js";
import { registerProjectFileCommands } from "./projectFileCommands.js";
import { ProjectFilesProvider, type ProjectFileNode } from "./projectFilesProvider.js";
import { watchProjectFiles } from "./projectFilesWatcher.js";

/** Reports every create, change or delete under a project folder. */
function watchFolder(folder: string, onChange: () => void): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, "**/*"));
  return vscode.Disposable.from(watcher, watcher.onDidCreate(onChange), watcher.onDidChange(onChange), watcher.onDidDelete(onChange));
}

interface ProjectViewsDeps {
  context: vscode.ExtensionContext;
  projects: WritingProjects;
  figures: ProjectFigures;
  session: ProjectSession;
  logger: ILogger;
  arcIcon: ArcIcon;
  readingLists: ProjectReadingLists;
  outcomes: BuildOutcomes;
  previews: Pick<BuildPreviews, "onDidCountBodyPages">;
  onDidChangeBacklinks: vscode.Event<void>;
  setStatus: (paperIds: string[], status: ReadingStatus) => Promise<string[]>;
}

/** What the library sidebar view renders in its Projects section. */
export interface ProjectViewsHandles {
  projectsSource: SidebarProjectsSource;
  projectTrees: ProjectTreeMirror;
}

const RENAME = { label: "Rename…", action: "rename", command: "labshelf.writing.renameFile" };
const DELETE = { label: "Delete", action: "delete", danger: true, command: "labshelf.writing.deleteFile" };

function filesSpec(provider: ProjectFilesProvider): ProjectTreeSpec<ProjectFileNode> {
  const run = (id: string) => (): unknown => vscode.commands.executeCommand(id);
  return {
    view: "files", title: "Files", provider, empty: "No files.",
    actions: [
      { action: "newFile", label: "New file", icon: "new-file", run: run("labshelf.writing.newFile") },
      { action: "newFolder", label: "New folder", icon: "new-folder", run: run("labshelf.writing.newFolder") },
    ],
    menus: {
      labshelfProjectFolder: [
        { label: "New File…", action: "newFile", command: "labshelf.writing.newFile" },
        { label: "New Folder…", action: "newFolder", command: "labshelf.writing.newFolder" },
        RENAME, DELETE,
      ],
      labshelfProjectFile: [RENAME, DELETE],
      labshelfProjectSource: [{ label: "Set as Main File", action: "setMain", command: "labshelf.writing.setMain" }, RENAME, DELETE],
    },
  };
}

export function registerProjectViews(deps: ProjectViewsDeps): ProjectViewsHandles {
  const { context, projects, figures, session, logger, arcIcon, readingLists, outcomes } = deps;
  const projectsSource = new SidebarProjectsSource({
    projects, logger, readingLists, buildOutcomes: outcomes, readSignals: createSignalsReader(projects), watchFolder,
  });
  const files = new ProjectFilesProvider({ session, projects, logger });
  const outline = new OutlineTreeProvider(logger);
  const figuresView = new ProjectFiguresView({ session, figures, paths: projects.paths, arcIcon });
  const figuresTree = vscode.window.createTreeView("labshelf.writing.figures", { treeDataProvider: figuresView });
  figuresView.attach(figuresTree);
  context.subscriptions.push(
    projectsSource,
    files,
    figuresView,
    watchProjectFiles(session, () => files.refresh()),
    figuresTree,
    outline.follow(),
    vscode.commands.registerCommand(REVEAL_OUTLINE_COMMAND, showOutline),
    registerTypstOutline(),
  );
  registerProjectFileCommands({ context, session, logger, fs: projects.fs });
  const checklist = registerChecklistView({ context, session, projects, previews: deps.previews, readingLists, onDidChangeBacklinks: deps.onDidChangeBacklinks, setStatus: deps.setStatus, logger });
  const outlineSpec: ProjectTreeSpec<unknown> = {
    view: "outline", title: "Outline", provider: outline, empty: "Open a source file to see its outline.", actions: [], menus: {},
  };
  const projectTrees = new ProjectTreeMirror({ session, logger, specs: [filesSpec(files), outlineSpec, checklist] as Array<ProjectTreeSpec<unknown>> });
  context.subscriptions.push(projectTrees);
  return { projectsSource, projectTrees };
}
