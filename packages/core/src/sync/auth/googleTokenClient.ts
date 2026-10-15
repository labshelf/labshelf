/** Calls Google's token and revoke endpoints: authorization-code exchange, refresh and revocation. */
import { GOOGLE_REVOKE_URL, GOOGLE_TOKEN_URL } from "./googleEndpoints.js";
import type { OAuthClient } from "./oauthClient.js";
import { ReauthRequiredError } from "./reauthRequiredError.js";
import type { TokenData } from "./tokenStore.js";

/** The slice of `fetch` the token client uses, so tests and non-Node hosts can inject their own. */
export type FetchFn = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

/** Tokens as Google returns them; the refresh token is absent on refresh grants and on repeat consents. */
export interface GrantedTokens {
  access_token: string;
  refresh_token: string | undefined;
  expiry_ms: number;
}

class TokenRequestError extends Error {
  constructor(readonly status: number, readonly responseText: string) {
    super(`Google token request failed: HTTP ${status} ${responseText.slice(0, 200)}`);
  }
}

async function requestTokens(fetchImpl: FetchFn, client: OAuthClient, params: Record<string, string>): Promise<GrantedTokens> {
  const fields: Record<string, string> = { ...params, client_id: client.clientId };
  if (client.clientSecret) { fields["client_secret"] = client.clientSecret; }
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: Object.entries(fields).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&"),
  });
  if (!res.ok) {
    throw new TokenRequestError(res.status, await res.text().catch(() => ""));
  }
  const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return { access_token: data.access_token, refresh_token: data.refresh_token, expiry_ms: Date.now() + data.expires_in * 1000 };
}

/**
 * Trades the authorization code (with its PKCE verifier) for tokens.
 * @returns the tokens Google granted
 */
export function exchangeCode(
  fetchImpl: FetchFn,
  client: OAuthClient,
  grant: { code: string; verifier: string; redirectUri: string },
): Promise<GrantedTokens> {
  return requestTokens(fetchImpl, client, {
    grant_type: "authorization_code",
    code: grant.code,
    redirect_uri: grant.redirectUri,
    code_verifier: grant.verifier,
  });
}

/**
 * Renews the access token. The refresh token is kept unless Google rotates it.
 * @throws ReauthRequiredError when Google reports invalid_grant (HTTP 400 or 401): the refresh token is dead
 * @returns the renewed tokens
 */
export async function refreshTokens(
  fetchImpl: FetchFn,
  client: OAuthClient,
  tokens: TokenData,
  signInHint: string,
): Promise<TokenData> {
  try {
    const granted = await requestTokens(fetchImpl, client, { grant_type: "refresh_token", refresh_token: tokens.refresh_token });
    return {
      access_token: granted.access_token,
      refresh_token: granted.refresh_token || tokens.refresh_token,
      expiry_ms: granted.expiry_ms,
    };
  } catch (error) {
    if (error instanceof TokenRequestError && (error.status === 400 || error.status === 401) && /invalid_grant/.test(error.responseText)) {
      throw new ReauthRequiredError(signInHint);
    }
    throw error;
  }
}

/**
 * Revokes a token at Google.
 * @throws when Google cannot be reached or answers with an error status
 */
export async function revokeToken(fetchImpl: FetchFn, token: string): Promise<void> {
  const res = await fetchImpl(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST" });
  if (!res.ok) { throw new Error(`Google revoke failed: HTTP ${res.status}`); }
}
