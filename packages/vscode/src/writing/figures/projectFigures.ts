// Reads the figures of a project as Writing view rows and tells the view when they may have changed; watches the figure files and asks once before a figure command runs.
import * as vscode from "vscode";

import { createDebouncer, normalizeInputPath } from "@labshelf/core";
import type { FigureRecipe, FigureState, ProjectContentPort, ProjectEntry } from "@labshelf/core";
import type { WritingHost, WritingProjects } from "../projects/index.js";
import { disposeAll } from "../../disposables/index.js";

export type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

export interface FigureNode {
  kind: "figure";
  project: ReadyProject;
  /** The figure path as written in labshelf.yaml, relative to the project folder. */
  path: string;
  recipe: FigureRecipe;
  state: FigureState;
}

export class ProjectFigures implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly host: Pick<WritingHost, "current">, private readonly data: ProjectContentPort) {}

  /** The project's figures in labshelf.yaml order; none when they cannot be read, after logging why. */
  async children(project: ReadyProject): Promise<FigureNode[]> {
    const figures = project.settings.figures;
    if (!figures) { return []; }
    try {
      const states = await this.data.readFigureStates(project.folder, figures);
      return Object.entries(figures).map(([path, recipe]) => ({ kind: "figure", project, path, recipe, state: states[path]! }));
    } catch (error) {
      await this.host.current()?.logger.error("writing/figures", error, { action: "read-states", folder: project.folder });
      return [];
    }
  }

  refresh(): void {
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}

const CONFIRMED_KEY = "labshelf.writing.confirmedFigureCommands";
const RUN = "Run Command";

type Confirmed = Record<string, string[]>;

/** True when the user has confirmed this exact command for this project, now or earlier. */
export async function askFigureCommand(state: vscode.Memento, folder: string, command: string): Promise<boolean> {
  const confirmed = state.get<Confirmed>(CONFIRMED_KEY) ?? {};
  if (confirmed[folder]?.includes(command)) { return true; }
  const answer = await vscode.window.showWarningMessage(
    `Run "${command}" in ${folder}?`,
    {
      modal: true,
      detail: "This runs code from labshelf.yaml on your computer. LabShelf asks again when the command changes.",
    },
    RUN,
  );
  if (answer !== RUN) { return false; }
  // workspaceState stays on this machine, so a project synced from elsewhere never arrives already confirmed.
  await state.update(CONFIRMED_KEY, { ...confirmed, [folder]: [...confirmed[folder] ?? [], command] });
  return true;
}

const DEBOUNCE_MS = 300;

function watchedPatterns(projects: ReturnType<WritingProjects["list"]>): Array<{ folder: string; pattern: string }> {
  const watched: Array<{ folder: string; pattern: string }> = [];
  for (const entry of projects) {
    if (entry.kind !== "ready" || !entry.settings.figures) { continue; }
    const patterns = new Set<string>();
    for (const [figure, recipe] of Object.entries(entry.settings.figures)) {
      patterns.add(normalizeInputPath(figure));
      for (const input of recipe.inputs) { patterns.add(normalizeInputPath(input)); }
    }
    for (const pattern of patterns) { watched.push({ folder: entry.folder, pattern }); }
  }
  return watched;
}

/** The watchers follow the project list: they are rebuilt whenever it changes. */
export function watchFigureFiles(projects: Pick<WritingProjects, "list" | "onDidChange">, onChange: () => void): vscode.Disposable {
  let watchers: vscode.Disposable[] = [];
  const changed = createDebouncer(onChange, DEBOUNCE_MS);
  const schedule = (): void => changed.call();
  const disposeWatchers = (): void => {
    disposeAll(watchers);
    watchers = [];
  };
  const rebuild = (): void => {
    disposeWatchers();
    for (const { folder, pattern } of watchedPatterns(projects.list())) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, pattern));
      watcher.onDidCreate(schedule);
      watcher.onDidChange(schedule);
      watcher.onDidDelete(schedule);
      watchers.push(watcher);
    }
  };
  rebuild();
  return vscode.Disposable.from(projects.onDidChange(rebuild), { dispose: () => { disposeWatchers(); changed.cancel(); } });
}
