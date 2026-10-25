// Forks the templates repository, commits a template to a branch and opens a pull request.
import { githubRequest, type GitHubClient } from "./githubRequest.js";
import type { SubmitTemplateInput, SubmitTemplateResult, RepoRef } from "./templatePullRequest.js";
import { bytesToBase64 } from "../../encoding/index.js";
import type { TemplateFile } from "../index.js";
import { GitHubError } from "./githubError.js";

const MAX_POLLS = 30;
const POLL_MS = 2000;

interface RepoInfo {
  full_name: string;
}

// TRAP: <login>/<repo> may be an unrelated repository or a redirect left by a transferred upstream,
// so the fork is whatever POST /forks names: the existing fork, or a new one GitHub may rename.
async function ensureFork(
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

const BASE_BRANCH = "main";

interface Sha {
  sha: string;
}

async function syncFork(client: GitHubClient, fork: RepoRef): Promise<void> {
  await githubRequest(client, "sync", "POST", `${repoPath(fork)}/merge-upstream`, { branch: BASE_BRANCH });
}

async function commitTemplateFiles(
  client: GitHubClient,
  fork: RepoRef,
  input: { templateId: string; files: TemplateFile[]; message: string; branch: string },
): Promise<void> {
  const repo = repoPath(fork);
  const ref = await githubRequest<{ object: Sha }>(client, "base", "GET", `${repo}/git/ref/heads/${BASE_BRANCH}`);
  const baseSha = ref.object.sha;
  const base = await githubRequest<{ tree: Sha }>(client, "base", "GET", `${repo}/git/commits/${baseSha}`);

  const entries = [];
  for (const file of input.files) {
    const blob = await githubRequest<Sha>(client, "blob", "POST", `${repo}/git/blobs`, {
      content: bytesToBase64(file.bytes),
      encoding: "base64",
    });
    entries.push({ path: `templates/${input.templateId}/${file.path}`, mode: "100644", type: "blob", sha: blob.sha });
  }

  const tree = await githubRequest<Sha>(client, "tree", "POST", `${repo}/git/trees`, {
    base_tree: base.tree.sha,
    tree: entries,
  });
  const commit = await githubRequest<Sha>(client, "commit", "POST", `${repo}/git/commits`, {
    message: input.message,
    tree: tree.sha,
    parents: [baseSha],
  });
  await githubRequest(client, "branch", "POST", `${repo}/git/refs`, {
    ref: `refs/heads/${input.branch}`,
    sha: commit.sha,
  });
}

function repoPath(repo: RepoRef): string {
  return `/repos/${repo.owner}/${repo.repo}`;
}

export async function submitTemplatePullRequest(input: SubmitTemplateInput): Promise<SubmitTemplateResult> {
  const client = { fetch: input.fetch, token: input.token };
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const date = (input.now ?? (() => new Date()))().toISOString().slice(0, 10);
  const branch = `template/${input.templateId}-${date}`;
  const { upstream } = input;

  const fork = await ensureFork(client, upstream, sleep);
  await syncFork(client, fork);
  await commitTemplateFiles(client, fork, {
    templateId: input.templateId,
    files: input.files,
    message: input.title,
    branch,
  });
  const pull = await githubRequest<{ html_url: string }>(
    client,
    "pull",
    "POST",
    `/repos/${upstream.owner}/${upstream.repo}/pulls`,
    { title: input.title, body: input.body, head: `${fork.owner}:${branch}`, base: BASE_BRANCH },
  );
  return { url: pull.html_url, branch };
}
