// Creates the Projects view, shown while no project is open, and the Files, Outline and Figures views of the open project with their commands.
import * as vscode from "vscode";

import type { ILogger } from "@labshelf/core";
import { OutlineTreeProvider, REVEAL_OUTLINE_COMMAND, registerTypstOutline, revealOutline } from "../outline/index.js";
import { ProjectFiguresView, type ProjectFigures } from "../figures/index.js";
import type { ProjectSession, WritingProjects } from "../session/index.js";
import { registerProjectFileCommands } from "./projectFileCommands.js";
import { ProjectFilesProvider } from "./projectFilesProvider.js";
import { watchProjectFiles } from "./projectFilesWatcher.js";
import { WritingTreeProvider } from "./projectsTreeProvider.js";

interface ProjectViewsDeps {
  context: vscode.ExtensionContext;
  projects: WritingProjects;
  figures: ProjectFigures;
  session: ProjectSession;
  logger: ILogger;
}

export function registerProjectViews(deps: ProjectViewsDeps): void {
  const { context, projects, figures, session, logger } = deps;
  const list = new WritingTreeProvider(projects);
  const files = new ProjectFilesProvider({ session, projects, logger });
  const outline = new OutlineTreeProvider(logger);
  const figuresView = new ProjectFiguresView({ session, figures, paths: projects.paths });
  const figuresTree = vscode.window.createTreeView("labshelf.writing.figures", { treeDataProvider: figuresView });
  figuresView.attach(figuresTree);
  context.subscriptions.push(
    list,
    files,
    figuresView,
    watchProjectFiles(session, () => files.refresh()),
    vscode.window.createTreeView("labshelf.writing", { treeDataProvider: list }),
    vscode.window.createTreeView("labshelf.writing.files", { treeDataProvider: files }),
    vscode.window.createTreeView("labshelf.writing.outline", { treeDataProvider: outline }),
    figuresTree,
    outline.follow(),
    vscode.commands.registerCommand(REVEAL_OUTLINE_COMMAND, revealOutline),
    registerTypstOutline(),
  );
  registerProjectFileCommands({ context, session, logger });
}
