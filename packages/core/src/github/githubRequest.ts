// Sends one authenticated GitHub REST request and maps failures to GitHubError.
import { GitHubError } from "./githubError.js";
import type { GitHubStep } from "./types.js";

const API = "https://api.github.com";

export interface GitHubClient {
  fetch: typeof globalThis.fetch;
  token: string;
}

export async function githubRequest<T>(
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
    throw new GitHubError(step, 0, err instanceof Error ? err.message : String(err));
  }
  const data = (await response.json().catch(() => ({}))) as { message?: unknown };
  if (!response.ok) {
    const message = typeof data?.message === "string" ? data.message : response.statusText;
    throw new GitHubError(step, response.status, message);
  }
  return data as T;
}
