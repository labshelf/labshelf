// Builds the ports of the Publish screen from VS Code, the project builders and the core publishing functions.
import { readFile } from "node:fs/promises";

import { submitTemplatePullRequest, type ProjectFormat, type PublishBuildResult, type TemplateManifest } from "@labshelf/core";
import { checkTemplateForPublish, renderFirstPagePng, saveProjectAsTemplate } from "@labshelf/core/node";
import type { FinishedBuild } from "../../../build/index.js";
import type { PublishableProject, PublishPorts } from "@labshelf/core";
import { signInToGitHub } from "./githubAuth.js";
import { pickPublishProject, publishableById, type PublishProjectDeps } from "./pickPublishProject.js";

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
  await saveProjectAsTemplate(session.root, project.id, { name, category, license, description, authors, ...(latexEngine ? { engine: latexEngine } : {}) }, session.logger);
}

export function createPublishPorts(deps: PublishPortsDeps): Omit<PublishPorts, "logger" | "post"> {
  return {
    auth: { signIn: signInToGitHub },
    projects: { pick: () => pickPublishProject(deps), byId: (id) => publishableById(deps, id) },
    buildPdf: (project) => buildPdf(deps.builders, project),
    renderThumbnail: (pdf) => renderFirstPagePng(pdf, THUMBNAIL_WIDTH_PX),
    check: checkTemplateForPublish,
    submit: (input) => submitTemplatePullRequest({
      ...input, fetch: deps.fetch, now: () => new Date(), sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
    }),
    saveToMyTemplates: (project, manifest) => saveToMyTemplates(deps, project, manifest),
  };
}
