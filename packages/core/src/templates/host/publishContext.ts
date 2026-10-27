// Holds the state the Publish handlers share (ports, GitHub session, cached passing report) and reports their failures.
import { formatError, toError } from "../../errors/index.js";
import { TEMPLATES_LOG_MODULE } from "./createTemplateProject.js";
import type { PublishDraft } from "../protocol/index.js";
import type { PublishCheckReport } from "../publishCheckReport.js";
import type { GitHubSignIn, PublishableProject, PublishPorts } from "./publishPorts.js";

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
