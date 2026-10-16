// Creates blobs, a tree, a commit and a branch on the fork holding the template files.
import { bytesToBase64 } from "./base64.js";
import { githubRequest, type GitHubClient } from "./githubRequest.js";
import type { RepoRef, TemplateFile } from "./types.js";

export const BASE_BRANCH = "main";

interface Sha {
  sha: string;
}

export async function syncFork(client: GitHubClient, fork: RepoRef): Promise<void> {
  await githubRequest(client, "sync", "POST", `${repoPath(fork)}/merge-upstream`, { branch: BASE_BRANCH });
}

export async function commitTemplateFiles(
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
