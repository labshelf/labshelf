// Keeps the owner's Cloudflare account and its OAuth tokens in the secret slots an app provides.
import type { ILogger } from "../../ports/index.js";
import type { SecretSlot, StoredLock } from "../oauth/index.js";
import { parseRelayAccount, RELAY_ACCOUNT_LOG_MODULE, type RelayAccount } from "./relayAccount.js";

export interface RelayAccountSlots {
  account: SecretSlot;
  /** The Cloudflare OAuth tokens, as `storeCloudflareTokens` writes them. */
  tokens: SecretSlot;
  /** Lets one window at a time refresh the OAuth tokens. */
  refreshLock: StoredLock;
}

export interface RelayAccountStore {
  readonly tokens: SecretSlot;
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
