// Describes the owner's stored Cloudflare connection and reads it back from its JSON.
import type { DeployedRelay } from "../deploy/index.js";

/** The Worker name in the owner's account, which also names its address. */
export const RELAY_WORKER_NAME = "labshelf-relay";
export const RELAY_ACCOUNT_LOG_MODULE = "relay";

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

// CONTRACT: documents/contracts/relay.md#owner-account
export function parseRelayAccount(text: string): RelayAccount | undefined {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  if (typeof value !== "object" || value === null) { return undefined; }
  const record = value as Record<string, unknown>;
  const valid = FIELDS.every((field) => typeof record[field] === "string") && isCredential(record.credential);
  return valid ? (record as unknown as RelayAccount) : undefined;
}
