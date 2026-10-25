// Hands out a valid Cloudflare access token, refreshing it under a cross-window lock and storing the rotated tokens first.
import type { ILogger } from "../../ports/index.js";
import { CloudflareOauthError } from "./oauthError.js";
import type { RelayClock } from "../client/index.js";
import type { StoredSecret, StoredLock } from "./storedLock.js";
import { refreshCloudflareTokens, type CloudflareTokens } from "./tokenEndpoint.js";

const LOG_MODULE = "relay.deploy";
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
