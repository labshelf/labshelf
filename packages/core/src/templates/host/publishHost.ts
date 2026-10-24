// Runs the Publish screen's work: opens a project, runs its checks, signs in to GitHub and submits the pull request.
import type { PublishDraft, PublishProject } from "../protocol/index.js";
import type { PublishHost } from "./galleryHost.js";
import { noteFailure, requireProject, type PublishContext } from "./publishContext.js";
import { runPublishChecks } from "./runPublishChecks.js";
import { submitPublish } from "./publishTemplate.js";
import type { PublishableProject, PublishMessage, PublishPorts } from "./publishPorts.js";

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
