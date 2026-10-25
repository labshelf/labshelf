// Registers the command that lets the user choose the LaTeX engine of the active project and stores it in labshelf.yaml.
import * as vscode from "vscode";

import { LATEX_ENGINES, engineLabel, type LatexEngine } from "@labshelf/core";
import { owningProject } from "../../buildRootDocument.js";
import type { WritingHost, WritingProjects } from "../../session/index.js";
import { saveEngine } from "./toolchainDeps.js";

export const PICK_COMPILER_COMMAND = "labshelf.writing.pickCompiler";

interface PickCompilerDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "reload">;
}

type EnginePick = vscode.QuickPickItem & { engine: LatexEngine };

function enginePick(engine: LatexEngine, current: LatexEngine | undefined): EnginePick {
  return {
    label: engineLabel(engine),
    description: engine === current ? "current" : "",
    engine,
  };
}

async function pickCompiler(deps: PickCompilerDeps): Promise<void> {
  const active = vscode.window.activeTextEditor?.document.uri.fsPath;
  const project = active ? owningProject(deps.projects, active) : undefined;
  if (project?.settings.format !== "latex") { return; }
  const current = project.settings.engine;
  const picked = await vscode.window.showQuickPick(
    LATEX_ENGINES.map((engine) => enginePick(engine, current)),
    { placeHolder: `LaTeX compiler of ${project.settings.id}` },
  );
  if (picked && picked.engine !== current) { await saveEngine(deps, project, picked.engine); }
}

export function registerPickCompiler(deps: PickCompilerDeps): void {
  deps.context.subscriptions.push(vscode.commands.registerCommand(PICK_COMPILER_COMMAND, () => pickCompiler(deps)));
}
