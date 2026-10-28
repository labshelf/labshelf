// Registers Save project as template: asks for the template's details and stores the project under My templates.
import * as vscode from "vscode";

import {
  CATEGORY_LABELS, TEMPLATE_CATEGORIES, isLicenseExpression, type ProjectEntry, type TemplateKind,
} from "@labshelf/core";
import { writeProjectAsTemplate, type WriteTemplateInput } from "@labshelf/core/node";
import { runSafely } from "../../../command/index.js";
import { readActiveProject } from "../../build/index.js";
import { ensureToolchain, type ToolchainDeps } from "../../build/node/index.js";
import type { ReadyProject } from "../../projects/index.js";
import type { WritingHost, WritingProjects } from "../../projects/index.js";

const SAVE_TEMPLATE_COMMAND = "labshelf.templates.saveProject";

interface SaveProjectDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  tex: ToolchainDeps["tex"];
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "reload">;
  /** Called after a template was saved, so the gallery lists it. */
  onSaved: () => void;
}

type Details = Omit<WriteTemplateInput, "engine">;

async function pickCategory(): Promise<TemplateKind | undefined> {
  const items = TEMPLATE_CATEGORIES.map((category) => ({ label: CATEGORY_LABELS[category], category }));
  return (await vscode.window.showQuickPick(items, { placeHolder: "Category of the template" }))?.category;
}

function required(label: string): (value: string) => string | undefined {
  return (value) => (value.trim() === "" ? `${label} is required.` : undefined);
}

/** The details the user types, or undefined when they cancel any question. */
async function askDetails(defaultName: string): Promise<Details | undefined> {
  const name = (await vscode.window.showInputBox({ prompt: "Template name", value: defaultName, validateInput: required("The name") }))?.trim();
  if (!name) { return undefined; }
  const category = await pickCategory();
  if (!category) { return undefined; }
  const license = (await vscode.window.showInputBox({
    prompt: "License of the template (SPDX identifier)", value: "MIT",
    validateInput: (value) => (isLicenseExpression(value) ? undefined : "Enter an SPDX identifier such as MIT or CC-BY-4.0."),
  }))?.trim();
  if (!license) { return undefined; }
  const description = (await vscode.window.showInputBox({ prompt: "What the template is for", validateInput: required("The description") }))?.trim();
  if (!description) { return undefined; }
  const authorsText = await vscode.window.showInputBox({ prompt: "Authors, separated by commas", validateInput: required("At least one author") });
  const authors = (authorsText ?? "").split(",").map((author) => author.trim()).filter(Boolean);
  return authors.length === 0 ? undefined : { name, category, license, description, authors };
}

async function saveProject(deps: SaveProjectDeps, entry: ProjectEntry | undefined): Promise<void> {
  const session = await deps.host.require();
  if (!session) { return; }
  await runSafely(session.logger, SAVE_TEMPLATE_COMMAND, async () => {
    const project: ReadyProject | undefined = entry?.kind === "ready" ? entry : readActiveProject(deps.projects);
    if (!project) {
      await vscode.window.showInformationMessage("Choose a project to save as a template.");
      return;
    }
    const details = await askDetails(project.settings.id);
    if (!details) { return; }
    const needsEngine = project.settings.format === "latex" && !project.settings.engine;
    const toolchain = needsEngine
      ? await ensureToolchain({ tex: deps.tex, host: deps.host }, project)
      : undefined;
    if (needsEngine && !toolchain) { return; }
    const manifest = await writeProjectAsTemplate(
      session.root, project.settings.id, toolchain ? { ...details, engine: toolchain.engine } : details, session.logger,
    );
    deps.onSaved();
    void vscode.window.showInformationMessage(`Saved "${manifest.name}" as a template. Find it in the template gallery under My templates.`);
  });
}

export function registerProjectTemplateCommand(deps: SaveProjectDeps): void {
  deps.context.subscriptions.push(
    vscode.commands.registerCommand(SAVE_TEMPLATE_COMMAND, (entry?: ProjectEntry) => saveProject(deps, entry)),
  );
}
