// Remembers whether the last build of each project folder succeeded, and when, for the session.
import * as vscode from "vscode";

import type { ReadyProject } from "../buildRootDocument.js";
import type { BuildListener, BuildTrigger, FinishedBuild } from "./buildListener.js";

export interface BuildOutcome { ok: boolean; at: Date }

export class BuildOutcomes implements BuildListener, vscode.Disposable {
  private readonly outcomes = new Map<string, BuildOutcome>();
  private readonly changeEmitter = new vscode.EventEmitter<string>();
  /** Fires with the project folder whose build just finished. */
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly now: () => Date = () => new Date()) {}

  last(folder: string): BuildOutcome | undefined {
    return this.outcomes.get(folder);
  }

  // A build in progress changes nothing the Projects view shows.
  building(_projectFolder: string, _root: string): void {}

  finished(project: ReadyProject, _root: string, result: FinishedBuild, _trigger: BuildTrigger): void {
    this.outcomes.set(project.folder, { ok: result.status === "succeeded", at: this.now() });
    this.changeEmitter.fire(project.folder);
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
