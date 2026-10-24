// Forks the templates repository, commits a template to a branch and opens a pull request.
import { commitTemplateFiles, BASE_BRANCH, syncFork } from "./commitTemplateFiles.js";
import { ensureFork } from "./ensureFork.js";
import { githubRequest } from "./githubRequest.js";
import type { SubmitTemplateInput, SubmitTemplateResult } from "./templatePullRequest.js";

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
