// Runs the Publish screen's work: opens a project, runs its checks, signs in to GitHub and submits the pull request.
import { formatError, toError } from "../../errors/index.js";
import type { ILogger } from "../../ports/index.js";
import { PUBLISH_CHECK_IDS, type PublishBuildResult, type PublishCheckInput, type PublishCheckReport } from "../templateLabels.js";
import type { TemplateManifest } from "../templateManifest/index.js";
import type { PublishTemplateInput, PublishTemplateResult } from "./githubClient.js";
import { createPublishTemplateManifest, createThumbnailUri, TEMPLATES_LOG_MODULE, withAuthors, type PublishHost } from "./galleryHost.js";
import type { HostToGallery, PublishDraft, PublishProject } from "./protocol.js";

/** A writing project ready to publish: its build engine is already resolved. */
export interface PublishableProject {
  id: string;
  title: string;
  folder: string;
  /** Display name of the engine ("pdfLaTeX"). */
  engineLabel: string;
  format: TemplateManifest["format"];
  engine: TemplateManifest["engine"];
  /** Path of the main file, relative to the project folder. */
  main: string;
}

export interface GitHubSignIn {
  token: string;
  login: string;
}

export interface PublishPorts {
  logger: ILogger;
  post: (message: HostToGallery) => void;
  auth: {
    /** Throws when the user refuses or GitHub is unreachable. */
    signIn: () => Promise<GitHubSignIn>;
  };
  projects: {
    /** Quick pick of the projects; undefined when the user cancels. */
    pick: () => Promise<PublishableProject | undefined>;
    byId: (id: string) => Promise<PublishableProject | undefined>;
  };
  /** Builds the project with its declared engine. */
  buildPdf: (project: PublishableProject) => Promise<PublishBuildResult>;
  renderThumbnail: (pdf: Uint8Array) => Promise<Uint8Array>;
  check: (input: PublishCheckInput) => Promise<PublishCheckReport>;
  /** Opens the pull request; the adapter supplies `fetch`. */
  submit: (input: Omit<PublishTemplateInput, "fetch" | "now" | "sleep">) => Promise<PublishTemplateResult>;
  /** Saves the submitted template into the library's My templates. */
  saveToMyTemplates: (project: PublishableProject, manifest: TemplateManifest) => Promise<void>;
}

export type PublishStep = "open" | "check" | "signIn" | "submit" | "saveToMyTemplates";

export interface PublishContext {
  ports: PublishPorts;
  signedIn: GitHubSignIn | undefined;
  /** INVARIANT: only a report whose checks all passed is cached, under the key of the project and draft it ran for. */
  passed: { key: string; report: PublishCheckReport } | undefined;
}

const statusOf = (error: unknown): number | undefined => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
};

export const deriveDraftFingerprint = (projectId: string, d: PublishDraft): string => JSON.stringify([projectId, d.name, d.category, d.license, d.description]);

/** Logs the failure, posts an error notice and returns the cause for the page. */
export async function reportPublishFailure(ctx: PublishContext, step: PublishStep, projectId: string | undefined, error: unknown, notice: string): Promise<string> {
  await ctx.ports.logger.error(TEMPLATES_LOG_MODULE, toError(error), { action: "publish", step, projectId, status: statusOf(error) });
  const cause = formatError(error);
  ctx.ports.post({ type: "notice", kind: "error", text: `${notice}: ${cause}` });
  return cause;
}

export async function ensurePublishableProject(ctx: PublishContext, id: string): Promise<PublishableProject> {
  const project = await ctx.ports.projects.byId(id);
  if (project === undefined) { throw new Error(`no project has the id "${id}"`); }
  return project;
}

async function runPublishChecks(ctx: PublishContext, project: PublishableProject, draft: PublishDraft): Promise<PublishCheckReport> {
  const { ports } = ctx;
  const built = createPublishTemplateManifest(draft, project);
  if (!built.ok) { throw new Error(built.error); }
  ports.post({ type: "publish.checks", checks: PUBLISH_CHECK_IDS.map((id) => ({ id })), running: true });
  const report = await ports.check({
    projectFolder: project.folder, manifest: built.manifest, logger: ports.logger,
    buildPdf: () => ports.buildPdf(project), renderThumbnail: ports.renderThumbnail,
  });
  const thumbnail = report.thumbnail && createThumbnailUri(report.thumbnail);
  ports.post({ type: "publish.checks", checks: report.checks, running: false, ...(thumbnail ? { thumbnail } : {}) });
  ctx.passed = report.ok ? { key: deriveDraftFingerprint(project.id, draft), report } : undefined;
  return report;
}

/** Never trusts the page: a report is reused only when it passed for this exact project and draft. */
async function passingReport(ctx: PublishContext, project: PublishableProject, draft: PublishDraft): Promise<PublishCheckReport> {
  if (ctx.passed?.key === deriveDraftFingerprint(project.id, draft)) { return ctx.passed.report; }
  const report = await runPublishChecks(ctx, project, draft);
  if (!report.ok || !report.files) { throw new Error("The checks do not pass; fix them and run them again."); }
  return report;
}

const UPSTREAM = { owner: "labshelf", repo: "labshelf-templates" };

async function saveLocally(ctx: PublishContext, project: PublishableProject, manifest: TemplateManifest): Promise<void> {
  try {
    await ctx.ports.saveToMyTemplates(project, manifest);
  } catch (error) {
    await reportPublishFailure(ctx, "saveToMyTemplates", project.id, error, `The pull request is open, but "${manifest.name}" could not be saved to My templates`);
  }
}

async function submitPublish(ctx: PublishContext, page: PublishProject, draft: PublishDraft): Promise<void> {
  const { ports, signedIn } = ctx;
  try {
    if (signedIn === undefined) { throw new Error("Sign in with GitHub first."); }
    const project = await ensurePublishableProject(ctx, page.id);
    const built = createPublishTemplateManifest(draft, project);
    if (!built.ok) { throw new Error(built.error); }
    const report = await passingReport(ctx, project, draft);
    const manifest = { ...built.manifest, authors: [signedIn.login] };
    const result = await ports.submit({
      token: signedIn.token, upstream: UPSTREAM, templateId: manifest.id,
      files: withAuthors(report.files ?? [], manifest, signedIn.login),
      title: `Add template: ${manifest.name}`,
      body: `Adds the ${manifest.category} template "${manifest.name}" (${manifest.engine}, ${manifest.license}) by @${signedIn.login}.\n\n${manifest.description}`,
    });
    await ports.logger.log("INFO", TEMPLATES_LOG_MODULE, "template submitted", { projectId: project.id, templateId: manifest.id, url: result.url });
    await saveLocally(ctx, project, manifest);
    ports.post({ type: "publish.submitted", url: result.url });
  } catch (error) {
    const cause = await reportPublishFailure(ctx, "submit", page.id, error, `Could not submit "${draft.name}"`);
    ports.post({ type: "publish.failed", error: cause });
  }
}

const pageProject = (p: PublishableProject): PublishProject => ({ id: p.id, title: p.title, engineLabel: p.engineLabel });

async function open(ctx: PublishContext, projectId?: string): Promise<void> {
  const { projects, post } = ctx.ports;
  try {
    const project = projectId === undefined ? await projects.pick() : await ensurePublishableProject(ctx, projectId);
    if (project === undefined) { return; }
    post({ type: "publish.open", project: pageProject(project), draft: { name: project.title, category: "article", license: "MIT", description: "" } });
  } catch (error) {
    await reportPublishFailure(ctx, "open", projectId, error, "Could not open the Publish screen");
  }
}

async function check(ctx: PublishContext, page: PublishProject, draft: PublishDraft): Promise<void> {
  try {
    await runPublishChecks(ctx, await ensurePublishableProject(ctx, page.id), draft);
  } catch (error) {
    const cause = await reportPublishFailure(ctx, "check", page.id, error, "Could not run the checks");
    ctx.ports.post({ type: "publish.failed", error: cause });
  }
}

async function signIn(ctx: PublishContext): Promise<void> {
  try {
    ctx.signedIn = await ctx.ports.auth.signIn();
    ctx.ports.post({ type: "publish.auth", login: ctx.signedIn.login });
  } catch (error) {
    const cause = await reportPublishFailure(ctx, "signIn", undefined, error, "Could not sign in to GitHub");
    ctx.ports.post({ type: "publish.auth", error: cause });
  }
}

export function createPublishHost(ports: PublishPorts): PublishHost {
  const ctx: PublishContext = { ports, signedIn: undefined, passed: undefined };
  return {
    open: (projectId) => open(ctx, projectId),
    async handle(message) {
      switch (message.type) {
        case "publish.start": return open(ctx);
        case "publish.check": return check(ctx, message.project, message.draft);
        case "publish.signIn": return signIn(ctx);
        case "publish.submit": return submitPublish(ctx, message.project, message.draft);
      }
    },
  };
}
