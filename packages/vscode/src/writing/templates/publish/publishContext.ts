// Holds the state the Publish handlers share (ports, GitHub session, cached passing report) and reports their failures.
import type { PublishDraft } from "@labshelf/core";
import type { PublishCheckReport } from "@labshelf/core/node";
import { TEMPLATES_LOG_MODULE } from "../useTemplate.js";
import type { GitHubSignIn, PublishableProject, PublishPorts } from "./types.js";

export type PublishStep = "open" | "check" | "signIn" | "submit" | "saveToMyTemplates";

export interface PublishContext {
  ports: PublishPorts;
  signedIn: GitHubSignIn | undefined;
  /** INVARIANT: only a report whose checks all passed is cached, under the key of the project and draft it ran for. */
  passed: { key: string; report: PublishCheckReport } | undefined;
}

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const toError = (value: unknown): Error => (value instanceof Error ? value : new Error(String(value)));
const statusOf = (error: unknown): number | undefined => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
};

export const draftKey = (projectId: string, d: PublishDraft): string => JSON.stringify([projectId, d.name, d.category, d.license, d.description]);

/** Logs the failure, posts an error notice and returns the cause for the page. */
export async function noteFailure(ctx: PublishContext, step: PublishStep, projectId: string | undefined, error: unknown, notice: string): Promise<string> {
  await ctx.ports.logger.error(TEMPLATES_LOG_MODULE, toError(error), { action: "publish", step, projectId, status: statusOf(error) });
  const cause = describeError(error);
  ctx.ports.post({ type: "notice", kind: "error", text: `${notice}: ${cause}` });
  return cause;
}

export async function requireProject(ctx: PublishContext, id: string): Promise<PublishableProject> {
  const project = await ctx.ports.projects.byId(id);
  if (project === undefined) { throw new Error(`no project has the id "${id}"`); }
  return project;
}
