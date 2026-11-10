// Rotates the owner's relay Worker to a new address, retires the old one after a grace period and decides when abuse calls for it.

import { assertRelayServing, createCloudflareClient } from "./relayClient.js";
import { createAccessTokenReader, type RelayAccountDeps } from "./relayAccount.js";
import type { RelayAccount, RetiringRelay } from "./relayAccountStore.js";
import { deployRelay, removeRelay } from "./relayDeploy.js";
import { createWorkerName, RELAY_ACCOUNT_LOG_MODULE } from "./relayPaths.js";

/** How long a rotated-out relay keeps answering, so collaborators move to the new one first. */
export const RELAY_RETIRE_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * How long the old relay stays listed beside the new one: collaborators learn of the new relay only through the old one, and the
 * owner's devices leave the old relay as soon as it is withdrawn.
 */
export const RELAY_LISTING_WAIT_MS = 10_000;

/** Runs `run` while holding the lock the start-up relay update holds, so one window at a time changes the relay. */
export type RelayLock = <T>(run: () => Promise<T>) => Promise<T>;

export interface RetireRelayDeps extends RelayAccountDeps {
  withLock: RelayLock;
}

export interface RotateRelayDeps extends RetireRelayDeps {
  /** The bundled relay Worker source. */
  script: string;
  /** Offers the current relay to every share: the connected ones and the stored invites of the others. */
  offerToShares(): Promise<void>;
  /** Takes the relay out of the relay lists and stored invites of the shared projects on this device. */
  withdrawFromShares(relayUrl: string): Promise<void>;
  /** Moves the directory registration and the cards to the new relay; wired once the directory exists. */
  updateRegistration?(change: { previousUrl: string; relayUrl: string }): Promise<void>;
  progress?(step: "deploying" | "waiting" | "offering" | "withdrawing"): void;
}

export type RelayRotationOutcome =
  /** A previous rotation's relay is still within its grace period; rotating again would delete it early. */
  | { kind: "pending"; retireAfter: number }
  | { kind: "rotated"; previousUrl: string; relayUrl: string; retireAfter: number };

// CONTRACT: documents/contracts/relay.md#deploy
async function rotateLocked(deps: RotateRelayDeps, account: RelayAccount): Promise<RelayRotationOutcome> {
  const { logger, fetch, clock } = deps;
  const { credential, accountId, shareWorker } = account;
  const token = await createAccessTokenReader(deps, credential)();
  deps.progress?.("deploying");
  // The new relay finds the KV namespace titled labshelf-relay and binds it too, and binds the remote library in the share
  // Worker, which a rotation never replaces.
  const deployed = await deployRelay({
    token, accountId, script: deps.script, workerName: createWorkerName(), shareWorkerName: shareWorker.name, logger, fetch,
  });
  const retireAfter = clock.now() + RELAY_RETIRE_GRACE_MS;
  const retiring: RetiringRelay = {
    workerName: account.workerName, relayUrl: account.relayUrl, ownerSecret: account.ownerSecret, kvNamespaceId: account.kvNamespaceId, retireAfter,
  };
  // Saved before the offers, which read the current relay from the store; a rotation cut short still retires the old Worker.
  await deps.store.save({ credential, accountId, ...deployed, shareWorker, retiring });
  deps.progress?.("waiting");
  await assertRelayServing({ relayUrl: deployed.relayUrl, fetch, logger, clock });
  deps.progress?.("offering");
  await deps.offerToShares();
  await clock.sleep(RELAY_LISTING_WAIT_MS);
  // Withdrawn only after the new relay is listed, so collaborators always have the owner's relay to move to.
  deps.progress?.("withdrawing");
  await deps.withdrawFromShares(retiring.relayUrl);
  await deps.updateRegistration?.({ previousUrl: retiring.relayUrl, relayUrl: deployed.relayUrl });
  await logger.log("INFO", RELAY_ACCOUNT_LOG_MODULE, "Rotated the relay", { previousUrl: retiring.relayUrl, relayUrl: deployed.relayUrl, retireAfter });
  return { kind: "rotated", previousUrl: retiring.relayUrl, relayUrl: deployed.relayUrl, retireAfter };
}

/** Moves every share to a newly deployed relay; the share Worker stays. Resolves undefined when no account is connected. */
export async function rotateRelay(deps: RotateRelayDeps): Promise<RelayRotationOutcome | undefined> {
  return deps.withLock(async () => {
    // A retiring relay past its grace period goes first, so it does not block this rotation.
    await retireDue(deps);
    const account = await deps.store.get();
    if (!account) { return undefined; }
    if (account.retiring) { return { kind: "pending", retireAfter: account.retiring.retireAfter }; }
    return rotateLocked(deps, account);
  });
}

export type RelayRetirement = "none" | "waiting" | "retired";

async function retireDue(deps: RelayAccountDeps): Promise<RelayRetirement> {
  const account = await deps.store.get();
  const retiring = account?.retiring;
  if (!account || !retiring) { return "none"; }
  if (deps.clock.now() < retiring.retireAfter) { return "waiting"; }
  const token = await createAccessTokenReader(deps, account.credential)();
  // Both relays bind the namespace titled labshelf-relay; it goes only when the old relay had one of its own.
  const kvNamespaceId = retiring.kvNamespaceId === account.kvNamespaceId ? undefined : retiring.kvNamespaceId;
  await removeRelay({
    token, accountId: account.accountId, workerName: retiring.workerName, ...(kvNamespaceId ? { kvNamespaceId } : {}),
    logger: deps.logger, fetch: deps.fetch,
  });
  const { retiring: _retired, ...rest } = account;
  await deps.store.save(rest);
  await deps.logger.log("INFO", RELAY_ACCOUNT_LOG_MODULE, "Deleted the rotated-out relay", { relayUrl: retiring.relayUrl });
  return "retired";
}

/** Deletes the relay the last rotation replaced once its grace period has passed; run at start-up and hourly. */
export async function retireRelayIfDue(deps: RetireRelayDeps): Promise<RelayRetirement> {
  return deps.withLock(() => retireDue(deps));
}

/** The free plan's daily request limit of Workers, shared by every Worker of the account. */
export const WORKERS_DAILY_REQUEST_LIMIT = 100_000;
const MORNING_SHARE = 0.6;
const ANY_TIME_SHARE = 0.8;
const NOON_UTC_HOURS = 12;

/**
 * D13: rotate when the relay has used more than 60% of the daily limit before 12:00 UTC, more than 80% at any time, or when
 * Cloudflare already refused it for the limit (the 1027 page).
 */
export function decideAbuseRotation(requestsToday: number, now: number, limitRefused: boolean): boolean {
  if (limitRefused) { return true; }
  if (requestsToday > WORKERS_DAILY_REQUEST_LIMIT * ANY_TIME_SHARE) { return true; }
  return new Date(now).getUTCHours() < NOON_UTC_HOURS && requestsToday > WORKERS_DAILY_REQUEST_LIMIT * MORNING_SHARE;
}

/** How many requests the relay served so far this UTC day; undefined when no account is connected. */
export interface AbuseSignal {
  requestsToday(): Promise<number | undefined>;
}

const startOfUtcDay = (now: number): number => {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

/** The GraphQL query for the relay script's invocations since the start of the current UTC day. */
export function buildRelayRequestsQuery(accountId: string, scriptName: string, now: number): string {
  const since = new Date(startOfUtcDay(now)).toISOString();
  const until = new Date(now).toISOString();
  return `query { viewer { accounts(filter: {accountTag: ${JSON.stringify(accountId)}}) { workersInvocationsAdaptive(limit: 10000, `
    + `filter: {scriptName: ${JSON.stringify(scriptName)}, datetime_geq: ${JSON.stringify(since)}, datetime_leq: ${JSON.stringify(until)}}) `
    + "{ sum { requests } } } } }";
}

/** Sums the requests of a workersInvocationsAdaptive answer; throws when GraphQL reports errors or the shape is unknown. */
export function readRelayRequestsAnswer(body: unknown): number {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const errors = record.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    throw new Error(`Cloudflare analytics refused the query: ${errors.map((error) => String((error as { message?: unknown }).message)).join("; ")}`);
  }
  const accounts = (record.data as { viewer?: { accounts?: unknown } } | undefined)?.viewer?.accounts;
  if (!Array.isArray(accounts)) { throw new Error("Cloudflare analytics answered without the account"); }
  let total = 0;
  for (const account of accounts as { workersInvocationsAdaptive?: unknown }[]) {
    const rows = account.workersInvocationsAdaptive;
    if (!Array.isArray(rows)) { continue; }
    for (const row of rows as { sum?: { requests?: unknown } }[]) {
      const requests = row.sum?.requests;
      if (typeof requests === "number") { total += requests; }
    }
  }
  return total;
}

/** Reads the relay script's requests of the current UTC day from Cloudflare's GraphQL analytics (account-analytics.read). */
export function createCloudflareAbuseSignal(deps: RelayAccountDeps): AbuseSignal {
  return {
    async requestsToday() {
      const account = await deps.store.get();
      if (!account) { return undefined; }
      const token = await createAccessTokenReader(deps, account.credential)();
      const client = createCloudflareClient({ token, fetch: deps.fetch, logger: deps.logger });
      const query = buildRelayRequestsQuery(account.accountId, account.workerName, deps.clock.now());
      return readRelayRequestsAnswer(await client.call("POST", "/graphql", { query }));
    },
  };
}

export interface RotateOnAbuseDeps extends RotateRelayDeps {
  signal: AbuseSignal;
  /** True when a relay connection was refused with Cloudflare's 1027 limit page. */
  limitRefused: boolean;
}

/** Rotates the relay when D13 calls for it; resolves undefined when it does not or no account is connected. */
export async function rotateRelayOnAbuse(deps: RotateOnAbuseDeps): Promise<RelayRotationOutcome | undefined> {
  // The refusal alone decides, so a failing analytics read does not hold back the rotation it calls for.
  const requests = deps.limitRefused ? 0 : await deps.signal.requestsToday();
  if (requests === undefined) { return undefined; }
  if (!decideAbuseRotation(requests, deps.clock.now(), deps.limitRefused)) { return undefined; }
  await deps.logger.log("WARN", RELAY_ACCOUNT_LOG_MODULE, "The relay's traffic calls for a rotation", { requests, limitRefused: deps.limitRefused });
  return rotateRelay(deps);
}
