// Refreshes a view when files matching a glob appear in or leave the open project's folder outside the view.
import * as vscode from "vscode";

import type { ReadyProject } from "../mainDocument.js";
import type { ProjectSession } from "../session/index.js";
import { projectFolderUri } from "./projectFilesProvider.js";

// Coalesces a burst of events (a checkout, a build of figures) into one refresh.
const DEBOUNCE_MS = 200;

/** Keeps one watcher on `glob` under the open project's folder and replaces it when the session opens another project. */
export function watchProjectFiles(session: Pick<ProjectSession, "project" | "onDidChange">, refresh: () => void, glob = "**"): vscode.Disposable {
  let watcher: vscode.FileSystemWatcher | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(refresh, DEBOUNCE_MS);
  };
  const watch = (project: ReadyProject | undefined): void => {
    watcher?.dispose();
    watcher = undefined;
    if (!project) { return; }
    watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(projectFolderUri(project), glob));
    // Content changes do not change the tree, so only creations and deletions refresh it.
    watcher.onDidCreate(schedule);
    watcher.onDidDelete(schedule);
  };
  watch(session.project);
  const subscription = session.onDidChange(watch);
  return new vscode.Disposable(() => {
    subscription.dispose();
    clearTimeout(timer);
    watcher?.dispose();
  });
}
