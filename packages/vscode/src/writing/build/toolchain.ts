// Chooses the LaTeX compiler: the status bar item and quick pick for the project's engine, the engine save and the install prompt.
import * as vscode from "vscode";

import { LATEX_ENGINES, formatEngineLabel, type LatexEngine, type TexSetupAsk } from "@labshelf/core";
import { runSafely } from "../../command/index.js";
import { findOwningProject, type ReadyProject } from "../projects/index.js";
import type { WritingHost, WritingProjects } from "../projects/index.js";
import { readActiveProject } from "./builds.js";

const LIGHT = "Install Light";
const FULL = "Install Full";

export interface WriteEngineDeps {
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "data" | "reload">;
}

/** Stores the engine in the project's labshelf.yaml and reloads the project list; false when it could not be saved. */
export async function writeEngine(deps: WriteEngineDeps, project: ReadyProject, engine: LatexEngine): Promise<boolean> {
  const session = deps.host.current();
  if (!session) { return false; }
  let saved = false;
  await runSafely(session.logger, "labshelf.writing.setEngine", async () => {
    await deps.projects.data.updateProjectSettings(project.folder, { engine });
    await deps.projects.reload();
    saved = true;
  });
  return saved;
}

/** Asks the VS Code user whether to install LaTeX and shows install progress in a notification. */
export function createVscodeToolchainAsk(): TexSetupAsk {
  return {
    async chooseInstall() {
      const choice = await vscode.window.showInformationMessage(
        "LaTeX is not installed on this computer. LabShelf can install it for every LabShelf app.",
        {
          modal: true,
          detail: "Light installs TinyTeX (about 100 MB) and adds packages when a project needs them. "
            + "Full installs TeX Live (about 5 GB) and works offline.",
        },
        LIGHT,
        FULL,
      );
      if (choice === LIGHT) { return "tinytex"; }
      return choice === FULL ? "texlive" : undefined;
    },

    progress(title, run) {
      return Promise.resolve(vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title, cancellable: false },
        (progress) => run((message) => progress.report({ message })),
      ));
    },
  };
}

const PICK_COMPILER_COMMAND = "labshelf.writing.pickCompiler";

interface PickCompilerDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "reload">;
}

type EnginePick = vscode.QuickPickItem & { engine: LatexEngine };

function enginePick(engine: LatexEngine, current: LatexEngine | undefined): EnginePick {
  return {
    label: formatEngineLabel(engine),
    description: engine === current ? "current" : "",
    engine,
  };
}

async function pickCompiler(deps: PickCompilerDeps): Promise<void> {
  const active = vscode.window.activeTextEditor?.document.uri.fsPath;
  const project = active ? findOwningProject(deps.projects, active) : undefined;
  if (project?.settings.format !== "latex") { return; }
  const current = project.settings.engine;
  const picked = await vscode.window.showQuickPick(
    LATEX_ENGINES.map((engine) => enginePick(engine, current)),
    { placeHolder: `LaTeX compiler of ${project.settings.id}` },
  );
  if (picked && picked.engine !== current) { await writeEngine(deps, project, picked.engine); }
}

/** Registers the command that lets the user choose the LaTeX engine of the active project and stores it in labshelf.yaml. */
export function registerPickCompiler(deps: PickCompilerDeps): void {
  deps.context.subscriptions.push(vscode.commands.registerCommand(PICK_COMPILER_COMMAND, () => pickCompiler(deps)));
}

/** Shows the LaTeX compiler of the project that owns the active editor's file in the status bar and opens the compiler pick on click. */
export function registerCompilerStatusBar(context: vscode.ExtensionContext, projects: Pick<WritingProjects, "list" | "paths" | "onDidChange">): void {
  // Priority 49 places it right after the main-document item (50).
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
  item.command = PICK_COMPILER_COMMAND;

  const update = (): void => {
    const project = readActiveProject(projects);
    if (project?.settings.format !== "latex") {
      item.hide();
      return;
    }
    const engine = project.settings.engine;
    item.text = engine ? `$(gear) ${formatEngineLabel(engine)} $(chevron-down)` : "$(gear) Choose compiler";
    item.tooltip = `LaTeX compiler of ${project.settings.id}. Click to change it.`;
    item.show();
  };

  context.subscriptions.push(item, projects.onDidChange(update), vscode.window.onDidChangeActiveTextEditor(update));
  update();
}
