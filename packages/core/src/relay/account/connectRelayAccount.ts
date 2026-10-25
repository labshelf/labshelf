// Connects the owner's Cloudflare account: the credential, the account, then the relay deployed, saved and serving.
import {
  createCloudflareClient, deployRelay, listCloudflareAccounts, verifyCloudflareToken, assertRelayServing, type CloudflareAccount, type CloudflareClient,
} from "../client/index.js";
import { createAccessTokenReader, type RelayAccountDeps } from "./createAccessTokenReader.js";
import { RELAY_ACCOUNT_LOG_MODULE, RELAY_WORKER_NAME, type RelayCredential } from "./relayAccount.js";

/** What the relay is for, in the words every app shows before the owner connects Cloudflare. */
export const RELAY_PURPOSE = "LabShelf sets up a small relay in your own Cloudflare account, on the free plan. It carries every edit between "
  + "collaborators, end-to-end encrypted, and keeps them so collaborators sync even when you are offline.";

export interface ConnectRelayAccountDeps extends RelayAccountDeps {
  /** Signs in or asks for a pasted token; undefined when the owner cancels. */
  chooseCredential(): Promise<RelayCredential | undefined>;
  /** Asked only when the credential reaches more than one account; undefined when the owner cancels. */
  chooseAccount(accounts: CloudflareAccount[]): Promise<string | undefined>;
  /** The bundled Worker source. */
  script: string;
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
  const deployed = await deployRelay({ token, accountId, script: deps.script, workerName: RELAY_WORKER_NAME, logger, fetch });
  // CONTRACT: documents/contracts/relay.md#owner-account
  await deps.store.save({ credential, accountId, ...deployed });
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
