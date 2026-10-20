// Identifies the GitHub account authorized by a token without retaining the credential.
export async function readGitHubIdentity(fetch: typeof globalThis.fetch, token: string, signal?: AbortSignal): Promise<{ token: string; login: string }> {
  const response = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Could not identify the GitHub account (HTTP ${response.status})`);
  const user: unknown = await response.json();
  const login = (user as { login?: unknown } | null)?.login;
  if (typeof login !== "string" || !/^[a-z\d][a-z\d-]{0,38}$/i.test(login)) throw new Error("GitHub returned an invalid account");
  return { token, login };
}
