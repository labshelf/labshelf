// Finds the project a collaboration command acts on: the one passed in, the active editor's, or one the user picks.
import * as path from "node:path";
import * as vscode from "vscode";

import type { ProjectEntry } from "@labshelf/core";
import { owningProject, type WritingProjects } from "../../../writing/index.js";
import { projectName } from "../collabHost.js";

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;
/** A project folder path (from a script or another command) or a project entry (from a view). */
export type ProjectTarget = string | ProjectEntry | undefined;

export async function pickProject(
  projects: Pick<WritingProjects, "list" | "paths">, target: ProjectTarget, filter: (project: ReadyProject) => boolean, placeHolder: string,
): Promise<ReadyProject | undefined> {
  const ready = projects.list().filter((entry): entry is ReadyProject => entry.kind === "ready" && filter(entry));
  if (typeof target === "string") { return ready.find((entry) => entry.folder === path.resolve(target)); }
  if (target) { return ready.find((entry) => entry.folder === target.folder); }
  const file = vscode.window.activeTextEditor?.document.uri;
  const active = file?.scheme === "file" ? owningProject(projects, file.fsPath) : undefined;
  if (active && filter(active)) { return active; }
  if (ready.length === 0) { return undefined; }
  const picked = await vscode.window.showQuickPick(
    ready.map((project) => ({ label: projectName(project), description: project.folder, project })), { placeHolder },
  );
  return picked?.project;
}
