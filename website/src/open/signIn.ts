// The /open/ sign-in: Authorization Code + PKCE against Cloudflare. The verifier and state live in sessionStorage only for the
// redirect; the access token is returned to the caller and never written anywhere.
import { CloudflareOauthError, readAuthorizationCode, startCloudflareAuthorization } from "@labshelf/core";

const REDIRECT_URI = "https://labshelf.org/open/";
const SCOPES = "user-details.read"; // D7: no offline_access
const TOKEN_URL = "https://labshelf.org/api/oauth/token";
const VERIFIER_KEY = "labshelf.open.verifier";
const STATE_KEY = "labshelf.open.state";
const CLIENT_ID_KEY = "labshelf.open.clientId";

export async function beginSignIn(env: { storage: Storage; location: Location }): Promise<void> {
  const { url, state, verifier } = await startCloudflareAuthorization({ redirectUri: REDIRECT_URI, scopes: SCOPES });
  env.storage.setItem(VERIFIER_KEY, verifier);
  env.storage.setItem(STATE_KEY, state);
  env.storage.setItem(CLIENT_ID_KEY, new URL(url).searchParams.get("client_id") ?? "");
  env.location.assign(url);
}

function forget(storage: Storage): void {
  storage.removeItem(VERIFIER_KEY);
  storage.removeItem(STATE_KEY);
  storage.removeItem(CLIENT_ID_KEY);
}

/** The access token, or undefined when the page was not opened by a Cloudflare redirect. Throws a CloudflareOauthError on a refusal. */
export async function finishSignIn(env: { storage: Storage; location: Location; fetch: typeof fetch }): Promise<string | undefined> {
  const params = new URLSearchParams(env.location.search);
  if (!params.has("code") && !params.has("state") && !params.has("error")) { return undefined; }
  const expectedState = env.storage.getItem(STATE_KEY);
  const verifier = env.storage.getItem(VERIFIER_KEY);
  const clientId = env.storage.getItem(CLIENT_ID_KEY) ?? "";
  forget(env.storage);
  if (!expectedState || !verifier) { throw new CloudflareOauthError("state_mismatch", "no sign-in was begun in this tab"); }
  const code = readAuthorizationCode(env.location.href, expectedState);
  const body = new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT_URI });
  let response: Response;
  try {
    response = await env.fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
  } catch (error) {
    throw new CloudflareOauthError("unreachable", error instanceof Error ? error.message : String(error));
  }
  let parsed: unknown;
  try { parsed = await response.json(); } catch { parsed = undefined; }
  const answer = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  if (!response.ok || typeof answer["access_token"] !== "string") {
    const code = typeof answer["error"] === "string" ? answer["error"] : "bad_response";
    throw new CloudflareOauthError(code, typeof answer["error_description"] === "string" ? answer["error_description"] : `HTTP ${response.status}`);
  }
  return answer["access_token"];
}
