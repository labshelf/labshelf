// Trades an authorization code or a refresh token for Cloudflare tokens at the OAuth token endpoint, logging without secrets.
import type { ILogger } from "../../ports/index.js";
import { CLOUDFLARE_CLIENT_ID, CLOUDFLARE_REDIRECT_URI, CLOUDFLARE_TOKEN_URL } from "./oauthClient.js";
import { CloudflareOauthError } from "./oauthError.js";
import { formatError } from "../../errors/index.js";

const LOG_MODULE = "relay.deploy";

export interface CloudflareTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface TokenRequestOptions { fetch: typeof fetch; logger: ILogger; now(): number }

export function fetchCloudflareTokens(options: TokenRequestOptions & { code: string; verifier: string }): Promise<CloudflareTokens> {
  return requestTokens(options, "authorization_code", {
    code: options.code, code_verifier: options.verifier, redirect_uri: CLOUDFLARE_REDIRECT_URI,
  });
}

/** Cloudflare rotates the refresh token on every refresh: the one sent stops being valid. */
export function refreshCloudflareTokens(options: TokenRequestOptions & { refreshToken: string }): Promise<CloudflareTokens> {
  return requestTokens(options, "refresh_token", { refresh_token: options.refreshToken });
}

async function requestTokens(options: TokenRequestOptions, grant: string, fields: Record<string, string>): Promise<CloudflareTokens> {
  const { logger } = options;
  const body = new URLSearchParams({ grant_type: grant, client_id: CLOUDFLARE_CLIENT_ID, ...fields }).toString();
  let response: Response;
  try {
    response = await options.fetch(CLOUDFLARE_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  } catch (error) {
    const reason = formatError(error);
    await logger.log("ERROR", LOG_MODULE, "Cloudflare token endpoint unreachable", { grant, error: reason });
    throw new CloudflareOauthError("unreachable", reason);
  }
  const parsed = await readJson(response);
  const tokens = response.ok ? tokensOf(parsed, options.now()) : undefined;
  if (!tokens) {
    const code = typeof parsed.error === "string" ? parsed.error : "bad_response";
    const detail = typeof parsed.error_description === "string" ? parsed.error_description : `HTTP ${response.status}`;
    await logger.log("ERROR", LOG_MODULE, "Cloudflare refused the token request", { grant, status: response.status, code, detail });
    throw new CloudflareOauthError(code, detail);
  }
  await logger.log("INFO", LOG_MODULE, "Cloudflare issued tokens", { grant, expiresAt: new Date(tokens.expiresAt).toISOString() });
  return tokens;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await response.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function tokensOf(parsed: Record<string, unknown>, now: number): CloudflareTokens | undefined {
  const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } = parsed;
  if (typeof accessToken !== "string" || typeof refreshToken !== "string" || typeof expiresIn !== "number") { return undefined; }
  return { accessToken, refreshToken, expiresAt: now + expiresIn * 1000 };
}
