// Submits the signed-in user's template as a pull request, then keeps a copy in My templates.
import { TEMPLATES_LOG_MODULE } from "./useTemplate.js";
import type { PublishDraft, PublishProject } from "../protocol/index.js";
import type { TemplateManifest } from "../templateManifest/index.js";
import { noteFailure, requireProject, type PublishContext } from "./publishContext.js";
import { buildPublishManifest, withAuthors } from "./createTemplateManifest.js";
import { passingReport } from "./runPublishChecks.js";
import type { PublishableProject } from "./publishPorts.js";

const UPSTREAM = { owner: "labshelf", repo: "labshelf-templates" };

async function saveLocally(ctx: PublishContext, project: PublishableProject, manifest: TemplateManifest): Promise<void> {
  try {
    await ctx.ports.saveToMyTemplates(project, manifest);
  } catch (error) {
    await noteFailure(ctx, "saveToMyTemplates", project.id, error, `The pull request is open, but "${manifest.name}" could not be saved to My templates`);
  }
}

export async function submitPublish(ctx: PublishContext, page: PublishProject, draft: PublishDraft): Promise<void> {
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
