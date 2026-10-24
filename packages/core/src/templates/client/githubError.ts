// Carries the failed step, HTTP status and GitHub message with a user-facing explanation.
import type { GitHubStep } from "./templatePullRequest.js";

export class GitHubError extends Error {
  constructor(
    readonly step: GitHubStep,
    readonly status: number,
    readonly githubMessage: string,
  ) {
    super(describe(step, status, githubMessage));
    this.name = "GitHubError";
  }
}

function describe(step: GitHubStep, status: number, githubMessage: string): string {
  if (status === 0) return `Could not reach GitHub at the ${step} step: ${githubMessage}`;
  if (status === 401) return `GitHub rejected the sign-in at the ${step} step. Sign in again.`;
  if (status === 403) {
    return `GitHub refused the ${step} step: the token lacks permission or the rate limit is reached.`;
  }
  if (status === 422) return `GitHub rejected the ${step} step: ${githubMessage}`;
  return `GitHub failed at the ${step} step (status ${status}): ${githubMessage}`;
}
