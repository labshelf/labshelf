// The GitHub client that signs in with the device flow and submits a template as a pull request.
import { sleep as sleepFor } from "../async/index.js";
import { bytesToBase64 } from "../encoding/index.js";
import { formatError } from "../errors/index.js";
import type { TemplateFile } from "./communitySource.js";

export type GitHubStep =
  | "fork"
  | "wait"
  | "sync"
  | "base"
  | "blob"
  | "tree"
  | "commit"
  | "branch"
  | "pull";

export interface RepoReference {
  owner: string;
  repo: string;
}

export interface PublishTemplateInput {
  fetch: typeof globalThis.fetch;
  token: string;
  upstream: RepoReference;
  templateId: string;
  files: TemplateFile[];
  title: string;
  body: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface PublishTemplateResult {
  url: string;
  branch: string;
}

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

export async function readGitHubIdentity(fetch: typeof globalThis.fetch, token: string, signal?: AbortSignal): Promise<{ token: string; login: string }> {
  const response = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Could not identify the GitHub account (HTTP ${response.status})`);
  const user: unknown = await response.json();
  const login = (user as { login?: unknown } | null)?.login;
  if (typeof login !== "string" || !/^[a-z\d][a-z\d-]{0,38}$/i.test(login)) throw new Error("GitHub returned an invalid account");
  return { token, login };
}

export interface GitHubDeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

async function fetchGithubOAuthResponse(fetch: typeof globalThis.fetch, endpoint: string, fields: Record<string, string>, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(`https://github.com/login/${endpoint}`, {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(), signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  });
  if (!response.ok) throw new Error(`GitHub authorization failed (HTTP ${response.status})`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("GitHub returned an invalid authorization response");
  return body as Record<string, unknown>;
}

export async function startGitHubDeviceSignIn(fetch: typeof globalThis.fetch, clientId: string, signal: AbortSignal): Promise<GitHubDeviceAuthorization> {
  if (!clientId.trim()) throw new Error("This build has no GitHub OAuth Client ID. See the browser build setup.");
  const body = await fetchGithubOAuthResponse(fetch, "device/code", { client_id: clientId, scope: "public_repo" }, signal);
  if (typeof body.error === "string") throw new Error(`GitHub authorization failed: ${body.error}`);
  if (typeof body.device_code !== "string" || !body.device_code || typeof body.user_code !== "string" || !body.user_code
    || body.verification_uri !== "https://github.com/login/device"
    || !Number.isSafeInteger(body.expires_in) || Number(body.expires_in) <= 0 || Number(body.expires_in) > 900
    || !Number.isSafeInteger(body.interval) || Number(body.interval) <= 0) throw new Error("GitHub returned invalid device authorization fields");
  return { deviceCode: body.device_code, userCode: body.user_code, verificationUri: body.verification_uri,
    expiresIn: Number(body.expires_in), interval: Number(body.interval) };
}

function runGithubPollDelay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

export interface GitHubDevicePolling {
  fetch: typeof globalThis.fetch;
  clientId: string;
  authorization: GitHubDeviceAuthorization;
  signal: AbortSignal;
  now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export async function fetchGithubDeviceToken(input: GitHubDevicePolling): Promise<{ token: string; login: string }> {
  const { fetch, clientId, authorization, signal } = input;
  const now = input.now ?? Date.now;
  const deadline = now() + authorization.expiresIn * 1000;
  let interval = authorization.interval * 1000;
  while (now() < deadline) {
    await (input.wait ?? runGithubPollDelay)(Math.min(interval, deadline - now()), signal);
    signal.throwIfAborted();
    if (now() >= deadline) break;
    const body = await fetchGithubOAuthResponse(fetch, "oauth/access_token", {
      client_id: clientId, device_code: authorization.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }, signal);
    if (body.error === "authorization_pending") continue;
    if (body.error === "slow_down") { interval += 5000; continue; }
    if (typeof body.error === "string") throw new Error(`GitHub authorization failed: ${body.error}`);
    if (typeof body.access_token !== "string" || !body.access_token || body.token_type !== "bearer") throw new Error("GitHub returned an invalid access token");
    return readGitHubIdentity(fetch, body.access_token, signal);
  }
  throw new Error("GitHub authorization expired. Sign in again.");
}

const API = "https://api.github.com";

interface GitHubClient {
  fetch: typeof globalThis.fetch;
  token: string;
}

async function githubRequest<T>(
  client: GitHubClient,
  step: GitHubStep,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await client.fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${client.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (err) {
    throw new GitHubError(step, 0, formatError(err));
  }
  const data = (await response.json().catch(() => ({}))) as { message?: unknown };
  if (!response.ok) {
    const message = typeof data?.message === "string" ? data.message : response.statusText;
    throw new GitHubError(step, response.status, message);
  }
  return data as T;
}

const MAX_POLLS = 30;
const POLL_MS = 2000;

interface RepoInfo {
  full_name: string;
}

// TRAP: <login>/<repo> may be an unrelated repository or a redirect left by a transferred upstream,
// so the fork is whatever POST /forks names: the existing fork, or a new one GitHub may rename.
async function ensureFork(
  client: GitHubClient,
  upstream: RepoReference,
  sleep: (ms: number) => Promise<void>,
): Promise<RepoReference> {
  const created = await githubRequest<RepoInfo>(client, "fork", "POST", `/repos/${upstream.owner}/${upstream.repo}/forks`, {});
  const [owner, repo] = created.full_name.split("/") as [string, string];
  const fork: RepoReference = { owner, repo };
  for (let poll = 0; poll < MAX_POLLS; poll++) {
    if (await answers(client, fork)) return fork;
    await sleep(POLL_MS);
  }
  throw new GitHubError("wait", 0, `The fork ${created.full_name} was not ready after ${(MAX_POLLS * POLL_MS) / 1000}s.`);
}

async function answers(client: GitHubClient, fork: RepoReference): Promise<boolean> {
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

async function syncFork(client: GitHubClient, fork: RepoReference): Promise<void> {
  await githubRequest(client, "sync", "POST", `${repoPath(fork)}/merge-upstream`, { branch: BASE_BRANCH });
}

async function commitTemplateFiles(
  client: GitHubClient,
  fork: RepoReference,
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

function repoPath(repo: RepoReference): string {
  return `/repos/${repo.owner}/${repo.repo}`;
}

export async function publishTemplatePullRequest(input: PublishTemplateInput): Promise<PublishTemplateResult> {
  const client = { fetch: input.fetch, token: input.token };
  const sleep = input.sleep ?? sleepFor;
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
