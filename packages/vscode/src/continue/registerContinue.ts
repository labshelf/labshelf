// Starts recording project cursors and returns the source the Library view reads its Continue row from.
import * as vscode from "vscode";

import type { WritingProjects } from "../writing/index.js";
import { readContinueTargets, type ContinueLibrary, type ContinueSource } from "./continueTargets.js";
import { registerProjectCursorRecorder } from "./projectCursorRecorder.js";

export interface ContinueDeps {
  context: vscode.ExtensionContext;
  /** The open library, or undefined while none is. */
  library: () => ContinueLibrary | undefined;
  /** The Writing view's project list, which reloads itself when the library or a project changes. */
  projects: WritingProjects;
}

export function registerContinue(deps: ContinueDeps): ContinueSource {
  const { context, library, projects } = deps;
  const changed = new vscode.EventEmitter<void>();
  context.subscriptions.push(changed, projects.onDidChange(() => changed.fire()));
  registerProjectCursorRecorder(context, { projects, logger: () => library()?.logger, onRecorded: () => changed.fire() });
  return { targets: () => readContinueTargets(library(), projects), onDidChange: changed.event };
}
