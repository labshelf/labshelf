// Gets the user's fork of the upstream repository from GitHub, creating it and waiting until it answers.
import { GitHubError } from "./githubError.js";
import { githubRequest, type GitHubClient } from "./githubRequest.js";
import type { RepoRef } from "./templatePullRequest.js";

const MAX_POLLS = 30;
const POLL_MS = 2000;

interface RepoInfo {
  full_name: string;
}

// TRAP: <login>/<repo> may be an unrelated repository or a redirect left by a transferred upstream,
// so the fork is whatever POST /forks names: the existing fork, or a new one GitHub may rename.
export async function ensureFork(
  client: GitHubClient,
  upstream: RepoRef,
  sleep: (ms: number) => Promise<void>,
): Promise<RepoRef> {
  const created = await githubRequest<RepoInfo>(client, "fork", "POST", `/repos/${upstream.owner}/${upstream.repo}/forks`, {});
  const [owner, repo] = created.full_name.split("/") as [string, string];
  const fork: RepoRef = { owner, repo };
  for (let poll = 0; poll < MAX_POLLS; poll++) {
    if (await answers(client, fork)) return fork;
    await sleep(POLL_MS);
  }
  throw new GitHubError("wait", 0, `The fork ${created.full_name} was not ready after ${(MAX_POLLS * POLL_MS) / 1000}s.`);
}

async function answers(client: GitHubClient, fork: RepoRef): Promise<boolean> {
  try {
    const info = await githubRequest<RepoInfo>(client, "wait", "GET", `/repos/${fork.owner}/${fork.repo}`);
    return info.full_name.toLowerCase() === `${fork.owner}/${fork.repo}`.toLowerCase();
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return false;
    throw err;
  }
}
