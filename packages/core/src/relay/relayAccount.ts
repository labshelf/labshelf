// Runs the owner's Cloudflare account lifecycle: the access token, connect, update, the remote library's R2 bucket and disconnect.

import { sleep } from "../async/index.js";
import type { ILogger } from "../ports/index.js";
import {
  assertRelayServing, CloudflareApiError, createCloudflareClient, listCloudflareAccounts, verifyCloudflareToken,
  type CloudflareAccount, type CloudflareClient, type RelayClock,
} from "./relayClient.js";
import {
  deployRelay, deployShareWorker, removeRelay, updateRelayIfOlder, updateShareWorkerIfOlder, type RelayUpdateOutcome,
} from "./relayDeploy.js";
import { CloudflareOauthError, createCloudflareSession } from "./relayOAuth.js";
import type { RelayAccount, RelayAccountStore, RelayCredential } from "./relayAccountStore.js";
import { createWorkerName, RELAY_ACCOUNT_LOG_MODULE } from "./relayPaths.js";
import { RELAY_WORKER_BUILD } from "./protocolVersion.js";

// INVARIANT: each app bundle that deploys defines both from core/tools/relayWorker/bundleRelayWorker.mjs. They are read only
// inside the functions, so a bundle that does not define them loads safely as long as it never calls them.
declare const RELAY_WORKER_SCRIPT: string;
declare const SHARE_WORKER_SCRIPT: string;

export const readRelayWorkerScript = (): string => RELAY_WORKER_SCRIPT;
export const readShareWorkerScript = (): string => SHARE_WORKER_SCRIPT;

export const systemRelayClock: RelayClock = { now: () => Date.now(), sleep: (ms) => sleep(ms) };

export interface RelayAccountDeps {
  store: RelayAccountStore;
  fetch: typeof fetch;
  logger: ILogger;
  clock: RelayClock;
  /** Asks the owner and, on yes, runs a new sign-in that stores fresh tokens; resolves whether it did. */
  signInAgain(refused: CloudflareOauthError): Promise<boolean>;
}

/** The codes after which only a new sign-in helps. */
const SIGN_IN_AGAIN_CODES = new Set(["invalid_grant", "not_signed_in"]);

/** Each call reads the stored tokens again, so a token refreshed by another window is used. */
export function createAccessTokenReader(deps: RelayAccountDeps, credential: RelayCredential): () => Promise<string> {
  if (credential.kind === "token") { return async () => credential.token; }
  const { store, logger, clock } = deps;
  const session = createCloudflareSession({ tokens: store.tokens, lock: store.refreshLock, fetch: deps.fetch, logger, clock });
  return async () => {
    try {
      return await session.accessToken();
    } catch (error) {
      if (!(error instanceof CloudflareOauthError) || !SIGN_IN_AGAIN_CODES.has(error.code)) { throw error; }
      await logger.log("WARN", RELAY_ACCOUNT_LOG_MODULE, "Cloudflare refused the stored sign-in; asking the owner to sign in again", {
        code: error.code, error: error.message,
      });
      if (!(await deps.signInAgain(error))) { throw error; }
      return session.accessToken();
    }
  };
}

/** What the relay is for, in the words every app shows before the owner connects Cloudflare. */
export const RELAY_PURPOSE = "LabShelf sets up a small relay in your own Cloudflare account, on the free plan. It carries every edit between "
  + "collaborators, end-to-end encrypted, and keeps them so collaborators sync even when you are offline.";

export interface ConnectRelayAccountDeps extends RelayAccountDeps {
  /** Signs in or asks for a pasted token; undefined when the owner cancels. */
  chooseCredential(): Promise<RelayCredential | undefined>;
  /** Asked only when the credential reaches more than one account; undefined when the owner cancels. */
  chooseAccount(accounts: CloudflareAccount[]): Promise<string | undefined>;
  /** The bundled relay Worker source. */
  script: string;
  /** The bundled share Worker source; defaults to the app bundle's `SHARE_WORKER_SCRIPT`. */
  shareScript?: string;
  /** Offers the relay to the shared projects connected on this device. */
  offerToShares(): Promise<void>;
  progress?(step: "deploying" | "waiting"): void;
}

async function pickAccount(deps: ConnectRelayAccountDeps, client: CloudflareClient): Promise<string | undefined> {
  const accounts = await listCloudflareAccounts(client);
  if (accounts.length === 0) { throw new Error("the credential reaches no Cloudflare account; give it the account permissions LabShelf asks for"); }
  if (accounts.length === 1) { return accounts[0]?.id; }
  return deps.chooseAccount(accounts);
}

async function connectWith(deps: ConnectRelayAccountDeps, credential: RelayCredential): Promise<string | undefined> {
  const { logger, fetch } = deps;
  const token = await createAccessTokenReader(deps, credential)();
  const client = createCloudflareClient({ token, fetch, logger });
  // An OAuth token has no /user/tokens/verify; listing its accounts proves it works.
  if (credential.kind === "token") { await verifyCloudflareToken(client); }
  const accountId = await pickAccount(deps, client);
  if (!accountId) { return undefined; }
  deps.progress?.("deploying");
  // The share Worker goes first: the relay binds its `Mirror` class by script name.
  const shareScript = deps.shareScript ?? readShareWorkerScript();
  const shareWorker = await deployShareWorker({ token, accountId, script: shareScript, name: createWorkerName(), logger, fetch });
  const deployed = await deployRelay({
    token, accountId, script: deps.script, workerName: createWorkerName(), shareWorkerName: shareWorker.name, logger, fetch,
  });
  // CONTRACT: documents/contracts/relay.md#deploy
  await deps.store.save({ credential, accountId, ...deployed, shareWorker });
  deps.progress?.("waiting");
  await assertRelayServing({ relayUrl: deployed.relayUrl, fetch, logger, clock: deps.clock });
  await logger.log("INFO", RELAY_ACCOUNT_LOG_MODULE, "Connected Cloudflare", { accountId, relayUrl: deployed.relayUrl, credential: credential.kind });
  await deps.offerToShares();
  return deployed.relayUrl;
}

/** Resolves the relay address, or undefined when the owner cancelled at a choice. */
export async function connectRelayAccount(deps: ConnectRelayAccountDeps): Promise<string | undefined> {
  try {
    const credential = await deps.chooseCredential();
    return credential && (await connectWith(deps, credential));
  } finally {
    // Tokens from a sign-in that never became a connection would otherwise stay with nothing to delete them.
    if (!(await deps.store.get())) { await deps.store.forget(); }
  }
}

export interface DisconnectRelayAccountDeps extends RelayAccountDeps {
  /** Takes the relay out of the relay lists and stored invites of the shared projects on this device. */
  withdrawFromShares(relayUrl: string): Promise<void>;
  progress?(step: "deleting"): void;
}

/** Resolves undefined when no account is connected. */
export async function removeRelayAccount(deps: DisconnectRelayAccountDeps): Promise<{ accountId: string; relayUrl: string } | undefined> {
  const account = await deps.store.get();
  if (!account) { return undefined; }
  const { credential, accountId, workerName, kvNamespaceId, relayUrl, shareWorker, retiring } = account;
  // Asked before the withdrawal, so a refused sign-in leaves the shares as they are.
  const token = await createAccessTokenReader(deps, credential)();
  // Withdrawn first, so collaborators move to the next relay before this one stops answering.
  await deps.withdrawFromShares(relayUrl);
  if (retiring) { await deps.withdrawFromShares(retiring.relayUrl); }
  deps.progress?.("deleting");
  if (retiring) {
    // A rotated-out relay within its grace period goes too; its KV namespace only when the current relay does not bind it.
    const retiringKv = retiring.kvNamespaceId === kvNamespaceId ? {} : { kvNamespaceId: retiring.kvNamespaceId };
    await removeRelay({ token, accountId, workerName: retiring.workerName, ...retiringKv, logger: deps.logger, fetch: deps.fetch });
  }
  await removeRelay({ token, accountId, workerName, kvNamespaceId, shareWorker, logger: deps.logger, fetch: deps.fetch });
  // CONTRACT: documents/contracts/relay.md#deploy
  await deps.store.forget();
  await deps.logger.log("INFO", RELAY_ACCOUNT_LOG_MODULE, "Disconnected Cloudflare", { accountId, relayUrl });
  return { accountId, relayUrl };
}

/** Resolves undefined when no account is connected. The share Worker is updated first, so the class the relay binds exists. */
export async function updateOwnRelay(
  deps: RelayAccountDeps & { script: string; shareScript?: string },
): Promise<RelayUpdateOutcome | undefined> {
  const account = await deps.store.get();
  if (!account) { return undefined; }
  const { relayUrl, credential, accountId, workerName, kvNamespaceId, shareWorker } = account;
  const accessToken = createAccessTokenReader(deps, credential);
  const shareOutcome = await uploadShareWorker(deps, account, { accessToken, r2Bucket: shareWorker.r2Bucket, force: false });
  const outcome = await updateRelayIfOlder({
    relayUrl, bundledVersion: RELAY_WORKER_BUILD, accessToken, accountId, script: deps.script,
    workerName, kvNamespaceId, shareWorkerName: shareWorker.name, logger: deps.logger, fetch: deps.fetch,
  });
  await deps.logger.log("INFO", RELAY_ACCOUNT_LOG_MODULE, "Checked the relay version", { relayUrl, outcome, shareOutcome });
  return outcome;
}

interface ShareUpload { accessToken(): Promise<string>; r2Bucket: string | undefined; force: boolean }

function uploadShareWorker(deps: RelayAccountDeps & { shareScript?: string }, account: RelayAccount, upload: ShareUpload): Promise<RelayUpdateOutcome> {
  const { accountId, shareWorker } = account;
  return updateShareWorkerIfOlder({
    url: shareWorker.url, bundledVersion: RELAY_WORKER_BUILD, accessToken: upload.accessToken, accountId,
    script: deps.shareScript ?? readShareWorkerScript(), name: shareWorker.name, kvNamespaceId: shareWorker.kvNamespaceId,
    r2Bucket: upload.r2Bucket, force: upload.force, logger: deps.logger, fetch: deps.fetch,
  });
}

/** The bucket the owner creates in the Cloudflare dashboard; the OAuth scopes cannot create it ([Deploy](relay.md#deploy)). */
export const MIRROR_R2_BUCKET = "labshelf-mirror";

const MISSING_BUCKET_MESSAGE = `Create the R2 bucket ${MIRROR_R2_BUCKET} first (R2 needs a card on your Cloudflare account).`;

/** Uploads the share Worker again with or without the R2 binding and stores the choice; resolves without change when none is connected. */
async function setMirrorBucket(deps: RelayAccountDeps & { shareScript?: string }, r2Bucket: string | undefined): Promise<void> {
  const account = await deps.store.get();
  if (!account) { return; }
  const accessToken = createAccessTokenReader(deps, account.credential);
  try {
    await uploadShareWorker(deps, account, { accessToken, r2Bucket, force: true });
  } catch (error) {
    // Cloudflare refuses the upload, naming the bucket, when the binding points at a bucket the account does not have.
    if (r2Bucket !== undefined && error instanceof CloudflareApiError && /bucket|r2/i.test(error.cloudflareMessage)) {
      throw new Error(MISSING_BUCKET_MESSAGE, { cause: error });
    }
    throw error;
  }
  const { r2Bucket: _previous, ...shareWorker } = account.shareWorker;
  // CONTRACT: documents/contracts/relay.md#deploy
  await deps.store.save({ ...account, shareWorker: r2Bucket === undefined ? shareWorker : { ...shareWorker, r2Bucket } });
  await deps.logger.log("INFO", RELAY_ACCOUNT_LOG_MODULE, "Set the remote library's R2 bucket", { r2Bucket: r2Bucket ?? null });
}

/** Binds the bucket `labshelf-mirror` to the share Worker as `MIRROR_BUCKET`; throws a message naming the bucket when it is missing. */
export const bindMirrorBucket = (deps: RelayAccountDeps & { shareScript?: string }): Promise<void> => setMirrorBucket(deps, MIRROR_R2_BUCKET);

/** Uploads the share Worker without the R2 binding. */
export const unbindMirrorBucket = (deps: RelayAccountDeps & { shareScript?: string }): Promise<void> => setMirrorBucket(deps, undefined);
