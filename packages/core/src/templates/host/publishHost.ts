// Runs the Publish screen's work: opens a project, runs its checks, signs in to GitHub and submits the pull request.
import type { PublishDraft, PublishProject } from "../protocol/index.js";
import type { PublishHost } from "./galleryHost.js";
import { noteFailure, requireProject, type PublishContext } from "./publishContext.js";
import { runPublishChecks, passingReport } from "./runPublishChecks.js";
import type { PublishableProject, PublishMessage, PublishPorts } from "./publishPorts.js";
import { TEMPLATES_LOG_MODULE } from "./useTemplate.js";
import type { TemplateManifest } from "../templateManifest/index.js";
import { buildPublishManifest, withAuthors } from "./createTemplateManifest.js";

const UPSTREAM = { owner: "labshelf", repo: "labshelf-templates" };

async function saveLocally(ctx: PublishContext, project: PublishableProject, manifest: TemplateManifest): Promise<void> {
  try {
    await ctx.ports.saveToMyTemplates(project, manifest);
  } catch (error) {
    await noteFailure(ctx, "saveToMyTemplates", project.id, error, `The pull request is open, but "${manifest.name}" could not be saved to My templates`);
  }
}

async function submitPublish(ctx: PublishContext, page: PublishProject, draft: PublishDraft): Promise<void> {
  const { ports, signedIn } = ctx;
  try {
    if (signedIn === undefined) { throw new Error("Sign in with GitHub first."); }
    const project = await requireProject(ctx, page.id);
    const built = buildPublishManifest(draft, project);
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
    const cause = await noteFailure(ctx, "submit", page.id, error, `Could not submit "${draft.name}"`);
    ports.post({ type: "publish.failed", error: cause });
  }
}

const pageProject = (p: PublishableProject): PublishProject => ({ id: p.id, title: p.title, engineLabel: p.engineLabel });

async function open(ctx: PublishContext, projectId?: string): Promise<void> {
  const { projects, post } = ctx.ports;
  try {
    const project = projectId === undefined ? await projects.pick() : await requireProject(ctx, projectId);
    if (project === undefined) { return; }
    post({ type: "publish.open", project: pageProject(project), draft: { name: project.title, category: "article", license: "MIT", description: "" } });
  } catch (error) {
    await noteFailure(ctx, "open", projectId, error, "Could not open the Publish screen");
  }
}

async function check(ctx: PublishContext, page: PublishProject, draft: PublishDraft): Promise<void> {
  try {
    await runPublishChecks(ctx, await requireProject(ctx, page.id), draft);
  } catch (error) {
    const cause = await noteFailure(ctx, "check", page.id, error, "Could not run the checks");
    ctx.ports.post({ type: "publish.failed", error: cause });
  }
}

async function signIn(ctx: PublishContext): Promise<void> {
  try {
    ctx.signedIn = await ctx.ports.auth.signIn();
    ctx.ports.post({ type: "publish.auth", login: ctx.signedIn.login });
  } catch (error) {
    const cause = await noteFailure(ctx, "signIn", undefined, error, "Could not sign in to GitHub");
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
