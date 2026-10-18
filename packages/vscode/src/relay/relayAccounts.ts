// Keeps the owner's Cloudflare connection, its credential and the relay deployed with it, in VS Code's SecretStorage.
import type * as vscode from "vscode";

import type { DeployedRelay, ILogger, SecretSlot } from "@labshelf/core";

/** The Worker name in the owner's account, which also names its address. */
export const RELAY_WORKER_NAME = "labshelf-relay";
export const LOG_MODULE = "relay";
const ACCOUNT_SECRET = "labshelf.relay.account";
const OAUTH_TOKENS_SECRET = "labshelf.relay.cloudflareTokens";
const REFRESH_LOCK_SECRET = "labshelf.relay.cloudflareRefreshLock";

/** OAuth tokens live in their own secret, shared by every window; a pasted API token stays in the account. */
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

function toAccount(value: unknown): RelayAccount | undefined {
  if (typeof value !== "object" || value === null) { return undefined; }
  const record = value as Record<string, unknown>;
  const valid = FIELDS.every((field) => typeof record[field] === "string") && isCredential(record.credential);
  return valid ? (record as unknown as RelayAccount) : undefined;
}

export class RelayAccounts {
  /** The Cloudflare OAuth tokens, as `storeCloudflareTokens` writes them. */
  readonly oauthTokens: SecretSlot;
  /** The lock that lets one window at a time refresh the OAuth tokens. */
  readonly refreshLock: SecretSlot;

  constructor(private readonly secrets: vscode.SecretStorage, private readonly logger: ILogger) {
    this.oauthTokens = this.slot(OAUTH_TOKENS_SECRET);
    this.refreshLock = this.slot(REFRESH_LOCK_SECRET);
  }

  async get(): Promise<RelayAccount | undefined> {
    const text = await this.secrets.get(ACCOUNT_SECRET);
    if (!text) { return undefined; }
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = undefined; }
    const account = toAccount(parsed);
    // TRAP: the stored text holds the token and the owner secret, so only the fact that it does not parse reaches the log.
    if (!account) { void this.logger.log("WARN", LOG_MODULE, "Ignored a stored Cloudflare connection that does not parse"); }
    return account;
  }

  async save(account: RelayAccount): Promise<void> {
    await this.secrets.store(ACCOUNT_SECRET, JSON.stringify(account));
  }

  /** Deletes the connection with every Cloudflare secret it holds. */
  async forget(): Promise<void> {
    await Promise.all([ACCOUNT_SECRET, OAUTH_TOKENS_SECRET, REFRESH_LOCK_SECRET].map((name) => this.secrets.delete(name)));
  }

  private slot(name: string): SecretSlot {
    return {
      get: async () => this.secrets.get(name),
      store: async (value) => this.secrets.store(name, value),
      delete: async () => this.secrets.delete(name),
    };
  }
}
