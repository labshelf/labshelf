// Watches the figures and inputs of every project with figures and asks for a refresh, debounced, when one changes.
import * as vscode from "vscode";

import { normalizeInputPath } from "@labshelf/core";
import type { WritingProjects } from "../projectStore.js";

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
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(onChange, DEBOUNCE_MS);
  };
  const disposeWatchers = (): void => {
    for (const watcher of watchers) { watcher.dispose(); }
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
  return vscode.Disposable.from(projects.onDidChange(rebuild), { dispose: () => { disposeWatchers(); clearTimeout(timer); } });
}
