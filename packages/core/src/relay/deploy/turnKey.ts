// Creates and deletes the TURN key whose secret the Worker uses to mint ICE credentials.
import type { CloudflareClient } from "./api/index.js";

export interface TurnKey { uid: string; secret: string }

/** The `secret` is shown only in this answer, so keys with the same name (from an earlier attempt) are deleted first. */
export async function createTurnKey(client: CloudflareClient, accountId: string, name: string): Promise<TurnKey> {
  const existing = await client.call("GET", `/accounts/${accountId}/calls/turn_keys`);
  for (const key of Array.isArray(existing) ? (existing as { uid?: unknown; name?: unknown }[]) : []) {
    if (key.name === name && typeof key.uid === "string") { await deleteTurnKey(client, accountId, key.uid); }
  }
  const result = await client.call("POST", `/accounts/${accountId}/calls/turn_keys`, { name });
  const { uid, secret } = (typeof result === "object" && result !== null ? result : {}) as { uid?: unknown; secret?: unknown };
  if (typeof uid !== "string" || typeof secret !== "string") { throw new Error("Cloudflare created the TURN key but did not return its id and secret."); }
  return { uid, secret };
}

export async function deleteTurnKey(client: CloudflareClient, accountId: string, uid: string): Promise<void> {
  await client.call("DELETE", `/accounts/${accountId}/calls/turn_keys/${uid}`);
}
