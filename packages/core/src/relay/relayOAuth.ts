// Signs the owner in to Cloudflare: the consent URL with PKCE, the token endpoint, the cross-window lock and the refreshing session.

import { bytesToBase64Url } from "../encoding/index.js";
import { formatError } from "../errors/index.js";
import type { ILogger } from "../ports/index.js";
import type { RelayClock } from "./relayClient.js";

const CLOUDFLARE_CLIENT_ID = "6bf60d8231e753c5249c7044aa0c4aff";
const CLOUDFLARE_AUTHORIZE_URL = "https://dash.cloudflare.com/oauth2/auth";
const CLOUDFLARE_TOKEN_URL = "https://dash.cloudflare.com/oauth2/token";
/** Registered exactly, port included: the desktop app listens here for the consent redirect. */
export const CLOUDFLARE_REDIRECT_PORT = 8976;
export const CLOUDFLARE_REDIRECT_URI = `http://127.0.0.1:${CLOUDFLARE_REDIRECT_PORT}/callback`;
// TRAP: the server checks every scope against the client's registered list before login, and refuses with invalid_scope.
const CLOUDFLARE_SCOPES = "workers-scripts.admin workers-kv-storage.write account-settings.read offline_access";
const CONNECTED_PAGE = "https://labshelf.org/connected/?service=cloudflare";

/** The page the loopback sends the browser to; it carries an error code, never a token or a code. */
export function deriveConnectedPageUrl(errorCode?: string): string {
  return errorCode ? `${CONNECTED_PAGE}&error=${encodeURIComponent(errorCode)}` : CONNECTED_PAGE;
}

export class CloudflareOauthError extends Error {
  override readonly name = "CloudflareOauthError";

  /**
   * An OAuth error code (`invalid_grant`, `access_denied`, ...) or one of LabShelf's: `state_mismatch`, `no_code`,
   * `bad_response`, `unreachable`, `not_signed_in`. `invalid_grant` and `not_signed_in` mean the user must sign in again.
   */
  constructor(readonly code: string, detail: string) {
    super(`Cloudflare sign-in failed (${code}): ${detail}`);
  }
}

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

/** Throws a `CloudflareOauthError` for a redirect with another state, an error, or no code. */
export function readAuthorizationCode(callbackUrl: string, expectedState: string): string {
  const params = new URL(callbackUrl).searchParams;
  // INVARIANT: the state is checked before the error, so a forged redirect cannot even choose the error shown.
  if (params.get("state") !== expectedState) { throw new CloudflareOauthError("state_mismatch", "the redirect does not belong to this sign-in"); }
  const error = params.get("error");
  if (error) { throw new CloudflareOauthError(error, params.get("error_description") ?? "Cloudflare refused the sign-in"); }
  const code = params.get("code");
  if (!code) { throw new CloudflareOauthError("no_code", "the redirect carries no authorization code"); }
  return code;
}

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
function refreshCloudflareTokens(options: TokenRequestOptions & { refreshToken: string }): Promise<CloudflareTokens> {
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

/** One named value in a secret store that several processes share, such as VS Code's SecretStorage. */
export interface StoredSecret {
  get(): Promise<string | undefined>;
  store(value: string): Promise<void>;
  delete(): Promise<void>;
}

export interface StoredLock { run<T>(task: () => Promise<T>): Promise<T> }

/** A holder that crashed mid-refresh frees the lock after this long; a refresh takes a few seconds. */
const STALE_AFTER_MS = 30_000;
/** Long enough for a competing write to land, so that reading back tells who won. */
const SETTLE_MS = 150;
const POLL_MS = 250;

interface Holder { owner: string; at: number }

function parseHolder(text: string | undefined): Holder | undefined {
  if (!text) { return undefined; }
  try {
    const value = JSON.parse(text) as Partial<Holder>;
    return typeof value.owner === "string" && typeof value.at === "number" ? { owner: value.owner, at: value.at } : undefined;
  } catch {
    return undefined;
  }
}

// TRAP: the slot has no compare-and-set, so the lock writes, waits and reads back; two writers that both read it free
// leave the last write in place, and only that writer proceeds.
export function createStoredLock(slot: StoredSecret, clock: RelayClock): StoredLock {
  async function acquire(owner: string): Promise<void> {
    for (;;) {
      const holder = parseHolder(await slot.get());
      if (!holder || clock.now() - holder.at > STALE_AFTER_MS) {
        await slot.store(JSON.stringify({ owner, at: clock.now() }));
        await clock.sleep(SETTLE_MS);
        if (parseHolder(await slot.get())?.owner === owner) { return; }
      }
      await clock.sleep(POLL_MS);
    }
  }

  return {
    async run(task) {
      const owner = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
      await acquire(owner);
      try {
        return await task();
      } finally {
        if (parseHolder(await slot.get())?.owner === owner) { await slot.delete(); }
      }
    },
  };
}

/** A token this close to expiry is refreshed, so a deploy that starts with it does not lose it midway. */
const EXPIRY_MARGIN_MS = 5 * 60_000;

export interface CloudflareSessionOptions {
  /** Holds the tokens as JSON; shared by every window. */
  tokens: StoredSecret;
  lock: StoredLock;
  fetch: typeof fetch;
  logger: ILogger;
  clock: RelayClock;
}

export interface CloudflareSession {
  /** Throws a `CloudflareOauthError` with `not_signed_in` or `invalid_grant` when the user must sign in again. */
  accessToken(): Promise<string>;
}

export function writeCloudflareTokens(slot: StoredSecret, tokens: CloudflareTokens): Promise<void> {
  return slot.store(JSON.stringify(tokens));
}

async function readTokens(slot: StoredSecret, logger: ILogger): Promise<CloudflareTokens> {
  const text = await slot.get();
  let value: Partial<CloudflareTokens> | undefined;
  try { value = text ? (JSON.parse(text) as Partial<CloudflareTokens>) : undefined; } catch { value = undefined; }
  if (typeof value?.accessToken === "string" && typeof value.refreshToken === "string" && typeof value.expiresAt === "number") {
    return value as CloudflareTokens;
  }
  // TRAP: the stored text holds the tokens, so only the fact that they are missing reaches the log.
  await logger.log("WARN", LOG_MODULE, "No usable Cloudflare tokens are stored", { stored: text !== undefined });
  throw new CloudflareOauthError("not_signed_in", "LabShelf holds no Cloudflare sign-in");
}

export function createCloudflareSession(options: CloudflareSessionOptions): CloudflareSession {
  const { tokens: slot, lock, logger, clock } = options;
  const fresh = (tokens: CloudflareTokens) => tokens.expiresAt - clock.now() > EXPIRY_MARGIN_MS;
  return {
    async accessToken() {
      const stored = await readTokens(slot, logger);
      if (fresh(stored)) { return stored.accessToken; }
      return lock.run(async () => {
        // Read again under the lock: another window may have refreshed while this one waited.
        const latest = await readTokens(slot, logger);
        if (fresh(latest)) { return latest.accessToken; }
        const rotated = await refreshCloudflareTokens({ refreshToken: latest.refreshToken, fetch: options.fetch, logger, now: () => clock.now() });
        // INVARIANT: stored before the access token is used; the refresh token sent is already revoked.
        await writeCloudflareTokens(slot, rotated);
        return rotated.accessToken;
      });
    },
  };
}
