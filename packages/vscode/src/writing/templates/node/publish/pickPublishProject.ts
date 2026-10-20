// Finds the writing projects a user can publish and resolves each one's build engine.
import * as vscode from "vscode";

import { engineLabel } from "@labshelf/core";
import { ensureToolchain } from "../../../build/node/index.js";
import type { ToolchainDeps } from "../../../build/toolchain/index.js";
import type { ReadyProject } from "../../../mainDocument.js";
import type { WritingHost, WritingProjects } from "../../../session/index.js";
import type { PublishableProject } from "@labshelf/core";

export interface PublishProjectDeps {
  tex: ToolchainDeps["tex"];
  host: WritingHost;
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "reload">;
}

const readyProjects = (deps: PublishProjectDeps): ReadyProject[] =>
  deps.projects.list().filter((entry): entry is ReadyProject => entry.kind === "ready");

/** The project with its engine; a LaTeX project without one asks for it, and undefined means the user cancelled that. */
async function toPublishable(deps: PublishProjectDeps, project: ReadyProject): Promise<PublishableProject | undefined> {
  const { id, format } = project.settings;
  if (project.main === undefined) { throw new Error(`project "${id}" has no main file`); }
  const engine = format === "typst" ? "typst" : project.settings.engine ?? (await ensureToolchain({ tex: deps.tex, host: deps.host }, project))?.engine;
  if (engine === undefined) { return undefined; }
  const label = engine === "typst" ? "Typst" : engineLabel(engine);
  return { id, title: id, folder: project.folder, engineLabel: label, format, engine, main: project.main };
}

export async function publishableById(deps: PublishProjectDeps, id: string): Promise<PublishableProject | undefined> {
  const project = readyProjects(deps).find((entry) => entry.settings.id === id);
  return project && toPublishable(deps, project);
}

export async function pickPublishProject(deps: PublishProjectDeps): Promise<PublishableProject | undefined> {
  const items = readyProjects(deps).map((project) => ({ label: project.settings.id, description: project.settings.format, project }));
  if (items.length === 0) {
    void vscode.window.showInformationMessage("Create a writing project to publish as a template.");
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(items, { placeHolder: "Project to publish as a template" });
  return picked && toPublishable(deps, picked.project);
}
