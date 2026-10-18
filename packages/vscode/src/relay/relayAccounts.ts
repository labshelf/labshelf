// Keeps the owner's Cloudflare connection, its API token and the relay deployed with it, in VS Code's SecretStorage.
import type * as vscode from "vscode";

import type { DeployedRelay, ILogger } from "@labshelf/core";

/** The Worker name in the owner's account, which also names its address. */
export const RELAY_WORKER_NAME = "labshelf-relay";
export const LOG_MODULE = "relay";
const SECRET_NAME = "labshelf.relay.account";

export interface RelayAccount extends DeployedRelay {
  token: string;
  accountId: string;
}

const FIELDS = ["token", "accountId", "relayUrl", "ownerSecret", "kvNamespaceId", "turnKeyId"] as const;

function toAccount(value: unknown): RelayAccount | undefined {
  if (typeof value !== "object" || value === null) { return undefined; }
  const record = value as Record<string, unknown>;
  return FIELDS.every((field) => typeof record[field] === "string") ? (record as unknown as RelayAccount) : undefined;
}

export class RelayAccounts {
  constructor(private readonly secrets: vscode.SecretStorage, private readonly logger: ILogger) {}

  async get(): Promise<RelayAccount | undefined> {
    const text = await this.secrets.get(SECRET_NAME);
    if (!text) { return undefined; }
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = undefined; }
    const account = toAccount(parsed);
    // TRAP: the stored text holds the token and the owner secret, so only the fact that it does not parse reaches the log.
    if (!account) { void this.logger.log("WARN", LOG_MODULE, "Ignored a stored Cloudflare connection that does not parse"); }
    return account;
  }

  async save(account: RelayAccount): Promise<void> {
    await this.secrets.store(SECRET_NAME, JSON.stringify(account));
  }

  async forget(): Promise<void> {
    await this.secrets.delete(SECRET_NAME);
  }
}
