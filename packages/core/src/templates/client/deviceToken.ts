// Polls GitHub device authorization while respecting expiration, cancellation and slow-down responses.
import { readGitHubIdentity } from "./githubIdentity.js";
import { fetchGithubOAuthResponse, type GitHubDeviceAuthorization } from "./deviceAuthorization.js";

export function runGithubPollDelay(ms: number, signal: AbortSignal): Promise<void> {
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
