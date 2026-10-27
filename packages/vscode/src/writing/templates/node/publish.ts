// Publishes a project as a template: the ports of the Publish screen from VS Code, the project builders and the core publishing functions, and the command that opens the screen.
import { readFile } from "node:fs/promises";

import {
  publishTemplatePullRequest,
  type ProjectEntry,
  type ProjectFormat,
  type PublishBuildResult,
  type TemplateManifest,
  type GitHubSignIn,
  formatEngineLabel,
  sleep,
} from "@labshelf/core";
import { checkTemplateForPublish, renderFirstPagePng, writeProjectAsTemplate } from "@labshelf/core/node";
import type { FinishedBuild } from "../../build/index.js";
import type { PublishableProject, PublishPorts } from "@labshelf/core";
import * as vscode from "vscode";
import { runSafely } from "../../../command/index.js";
import { ensureToolchain, type ToolchainDeps } from "../../build/node/index.js";
import type { ReadyProject } from "../../projects/index.js";
import type { WritingHost, WritingProjects } from "../../projects/index.js";

const PUBLISH_TEMPLATE_COMMAND = "labshelf.templates.publish";

interface PublishProjectDeps {
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
  const label = engine === "typst" ? "Typst" : formatEngineLabel(engine);
  return { id, title: id, folder: project.folder, engineLabel: label, format, engine, main: project.main };
}

async function publishableById(deps: PublishProjectDeps, id: string): Promise<PublishableProject | undefined> {
  const project = readyProjects(deps).find((entry) => entry.settings.id === id);
  return project && toPublishable(deps, project);
}

async function pickPublishProject(deps: PublishProjectDeps): Promise<PublishableProject | undefined> {
  const items = readyProjects(deps).map((project) => ({ label: project.settings.id, description: project.settings.format, project }));
  if (items.length === 0) {
    void vscode.window.showInformationMessage("Create a writing project to publish as a template.");
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(items, { placeHolder: "Project to publish as a template" });
  return picked && toPublishable(deps, picked.project);
}

/** Opening a pull request on the catalog needs `public_repo`; the token is used for that call and never stored here. */
export async function signInToGitHub(): Promise<GitHubSignIn> {
  const session = await vscode.authentication.getSession("github", ["public_repo"], { createIfNone: true });
  return { token: session.accessToken, login: session.account.label };
}

/** Within the 400 to 1600 pixels the catalog accepts for thumbnail.png. */
const THUMBNAIL_WIDTH_PX = 800;
const BUILD_UNFINISHED = "The build did not finish.";

export type PublishBuilders = Record<ProjectFormat, { request(folder: string, root: string, trigger: "command"): Promise<FinishedBuild | undefined> }>;

export interface PublishPortsDeps extends PublishProjectDeps {
  builders: PublishBuilders;
  /** Reaches GitHub; identifies the extension to it. */
  fetch: typeof globalThis.fetch;
}

async function buildPdf(builders: PublishBuilders, project: PublishableProject): Promise<PublishBuildResult> {
  const build = await builders[project.format].request(project.folder, project.main, "command");
  if (build === undefined) { return { ok: false, problems: [BUILD_UNFINISHED] }; }
  if (build.status === "succeeded") { return { ok: true, pdf: new Uint8Array(await readFile(build.pdf)) }; }
  const errors = build.problems.filter((problem) => problem.severity === "error").map((problem) => problem.message);
  return { ok: false, problems: errors.length > 0 ? errors : ["The build failed."] };
}

async function saveToMyTemplates(deps: PublishPortsDeps, project: PublishableProject, manifest: TemplateManifest): Promise<void> {
  const session = deps.host.current();
  if (!session) { throw new Error("No library is open to save the template in."); }
  const { name, category, license, description, authors, engine } = manifest;
  const latexEngine = engine === "typst" ? undefined : engine;
  await writeProjectAsTemplate(session.root, project.id, { name, category, license, description, authors, ...(latexEngine ? { engine: latexEngine } : {}) }, session.logger);
}

export function createPublishPorts(deps: PublishPortsDeps): Omit<PublishPorts, "logger" | "post"> {
  return {
    auth: { signIn: signInToGitHub },
    projects: { pick: () => pickPublishProject(deps), byId: (id) => publishableById(deps, id) },
    buildPdf: (project) => buildPdf(deps.builders, project),
    renderThumbnail: (pdf) => renderFirstPagePng(pdf, THUMBNAIL_WIDTH_PX),
    check: checkTemplateForPublish,
    submit: (input) => publishTemplatePullRequest({
      ...input, fetch: deps.fetch, now: () => new Date(), sleep,
    }),
    saveToMyTemplates: (project, manifest) => saveToMyTemplates(deps, project, manifest),
  };
}

interface PublishCommandDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  /** Opens the gallery on the Publish screen; without an id the host asks which project. */
  openPublish: (projectId?: string) => Promise<void>;
}

export function registerPublishCommand({ context, host, openPublish }: PublishCommandDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(PUBLISH_TEMPLATE_COMMAND, async (entry?: ProjectEntry) => {
      const session = await host.require();
      if (!session) { return; }
      await runSafely(session.logger, PUBLISH_TEMPLATE_COMMAND, () => openPublish(entry?.kind === "ready" ? entry.settings.id : undefined));
    }),
  );
}
