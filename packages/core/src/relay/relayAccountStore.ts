// Describes the owner's stored Cloudflare connection and keeps it, with its OAuth tokens, in the secret slots an app provides.

import { parseJsonObject } from "../json/index.js";
import type { ILogger } from "../ports/index.js";
import type { DeployedRelay } from "./relayClient.js";
import type { StoredLock, StoredSecret } from "./relayOAuth.js";
import { RELAY_ACCOUNT_LOG_MODULE } from "./relayPaths.js";

/** OAuth tokens live in their own slot, shared by every window; a pasted API token stays in the account. */
export type RelayCredential = { kind: "oauth" } | { kind: "token"; token: string };

export interface RelayAccount extends DeployedRelay {
  credential: RelayCredential;
  accountId: string;
}

const FIELDS = ["accountId", "relayUrl", "ownerSecret", "kvNamespaceId"] as const;

function isCredential(value: unknown): value is RelayCredential {
  if (typeof value !== "object" || value === null) { return false; }
  const record = value as Record<string, unknown>;
  return record.kind === "oauth" || (record.kind === "token" && typeof record.token === "string");
}

// CONTRACT: documents/contracts/relay.md#deploy
export function parseRelayAccount(text: string): RelayAccount | undefined {
  const record = parseJsonObject(text);
  if (!record) { return undefined; }
  const valid = FIELDS.every((field) => typeof record[field] === "string") && isCredential(record.credential);
  return valid ? (record as unknown as RelayAccount) : undefined;
}

export interface RelayAccountSlots {
  account: StoredSecret;
  /** The Cloudflare OAuth tokens, as `writeCloudflareTokens` writes them. */
  tokens: StoredSecret;
  /** Lets one window at a time refresh the OAuth tokens. */
  refreshLock: StoredLock;
}

export interface RelayAccountStore {
  readonly tokens: StoredSecret;
  readonly refreshLock: StoredLock;
  get(): Promise<RelayAccount | undefined>;
  save(account: RelayAccount): Promise<void>;
  /** Deletes the account with the sign-in tokens. */
  forget(): Promise<void>;
  status(): Promise<{ relayUrl: string } | undefined>;
}

export function createRelayAccountStore(slots: RelayAccountSlots, logger: ILogger): RelayAccountStore {
  const get = async (): Promise<RelayAccount | undefined> => {
    const text = await slots.account.get();
    if (!text) { return undefined; }
    const account = parseRelayAccount(text);
    // TRAP: the stored text holds the token and the owner secret, so only the fact that it does not parse reaches the log.
    if (!account) { await logger.log("WARN", RELAY_ACCOUNT_LOG_MODULE, "Ignored a stored Cloudflare connection that does not parse"); }
    return account;
  };
  return {
    tokens: slots.tokens,
    refreshLock: slots.refreshLock,
    get,
    save: (account) => slots.account.store(JSON.stringify(account)),
    async forget() { await Promise.all([slots.account.delete(), slots.tokens.delete()]); },
    async status() {
      const account = await get();
      return account && { relayUrl: account.relayUrl };
    },
  };
}
