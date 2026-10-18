// Builds the Cloudflare consent URL with PKCE (S256) and a state, and reads the code from the redirect it comes back with.
import { bytesToBase64Url } from "../../../encoding/index.js";
import { CLOUDFLARE_AUTHORIZE_URL, CLOUDFLARE_CLIENT_ID, CLOUDFLARE_REDIRECT_URI, CLOUDFLARE_SCOPES } from "./oauthClient.js";
import { CloudflareOAuthError } from "./oauthError.js";

export interface CloudflareAuthorization {
  url: string;
  /** Kept in memory only, to check the redirect against. */
  state: string;
  /** Kept in memory only, and sent with the code exchange. */
  verifier: string;
}

const randomUrlSafe = (bytes: number) => bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function startCloudflareAuthorization(): Promise<CloudflareAuthorization> {
  const verifier = randomUrlSafe(32);
  const state = randomUrlSafe(16);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const url = new URL(CLOUDFLARE_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: CLOUDFLARE_CLIENT_ID,
    redirect_uri: CLOUDFLARE_REDIRECT_URI,
    scope: CLOUDFLARE_SCOPES,
    state,
    code_challenge: bytesToBase64Url(new Uint8Array(digest)),
    code_challenge_method: "S256",
  }).toString().replace(/\+/g, "%20"); // TRAP: hosts that re-encode the URL (vscode.Uri) turn a form "+" into "%2B" and merge the scopes.
  return { url: url.href, state, verifier };
}

/** Throws a `CloudflareOAuthError` for a redirect with another state, an error, or no code. */
export function readAuthorizationCode(callbackUrl: string, expectedState: string): string {
  const params = new URL(callbackUrl).searchParams;
  // INVARIANT: the state is checked before the error, so a forged redirect cannot even choose the error shown.
  if (params.get("state") !== expectedState) { throw new CloudflareOAuthError("state_mismatch", "the redirect does not belong to this sign-in"); }
  const error = params.get("error");
  if (error) { throw new CloudflareOAuthError(error, params.get("error_description") ?? "Cloudflare refused the sign-in"); }
  const code = params.get("code");
  if (!code) { throw new CloudflareOAuthError("no_code", "the redirect carries no authorization code"); }
  return code;
}
