// Runs the publish checks for a project and draft, streams the result to the page and caches a passing report.
import { PUBLISH_CHECK_IDS, type PublishDraft } from "@labshelf/core";
import type { PublishCheckReport } from "@labshelf/core/node";
import { thumbnailDataUri } from "../thumbnailUri.js";
import { draftKey, type PublishContext } from "./publishContext.js";
import { buildPublishManifest } from "./publishManifest.js";
import type { PublishableProject } from "./types.js";

export async function runPublishChecks(ctx: PublishContext, project: PublishableProject, draft: PublishDraft): Promise<PublishCheckReport> {
  const { ports } = ctx;
  const built = buildPublishManifest(draft, project);
  if (!built.ok) { throw new Error(built.error); }
  ports.post({ type: "publish.checks", checks: PUBLISH_CHECK_IDS.map((id) => ({ id })), running: true });
  const report = await ports.check({
    projectFolder: project.folder, manifest: built.manifest, logger: ports.logger,
    buildPdf: () => ports.buildPdf(project), renderThumbnail: ports.renderThumbnail,
  });
  const thumbnail = report.thumbnail && thumbnailDataUri(report.thumbnail);
  ports.post({ type: "publish.checks", checks: report.checks, running: false, ...(thumbnail ? { thumbnail } : {}) });
  ctx.passed = report.ok ? { key: draftKey(project.id, draft), report } : undefined;
  return report;
}

/** Never trusts the page: a report is reused only when it passed for this exact project and draft. */
export async function passingReport(ctx: PublishContext, project: PublishableProject, draft: PublishDraft): Promise<PublishCheckReport> {
  if (ctx.passed?.key === draftKey(project.id, draft)) { return ctx.passed.report; }
  const report = await runPublishChecks(ctx, project, draft);
  if (!report.ok || !report.files) { throw new Error("The checks do not pass; fix them and run them again."); }
  return report;
}
