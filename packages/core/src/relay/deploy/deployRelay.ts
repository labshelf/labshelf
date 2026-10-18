// Deploys the relay Worker into an owner's Cloudflare account: KV, address, script, secrets and route.
import { bytesToBase64Url } from "../../encoding/index.js";
import type { ILogger } from "../../ports/index.js";
import { createCloudflareClient, type CloudflareClient } from "./api/index.js";
import { createTurnKey } from "./turnKey.js";
import { uploadWorker } from "./workerUpload.js";
import { ensureWorkersSubdomain } from "./workersSubdomain.js";

const OWNER_SECRET_BYTES = 32;

export interface DeployRelayOptions {
  token: string;
  accountId: string;
  /** The bundled Worker source. */
  script: string;
  workerName: string;
  logger: ILogger;
  fetch: typeof fetch;
}

export interface DeployedRelay {
  relayUrl: string;
  /** Kept on the owner's devices only: it authorises `/claim`. */
  ownerSecret: string;
  kvNamespaceId: string;
  turnKeyId: string;
}

export async function deployRelay(options: DeployRelayOptions): Promise<DeployedRelay> {
  const { token, accountId, script, workerName, logger } = options;
  const client = createCloudflareClient({ token, fetch: options.fetch, logger });
  const account = `/accounts/${accountId}`;
  const title = `labshelf-relay-${workerName}`;
  await logger.log("INFO", "relay.deploy", "Deploying relay", { accountId, workerName });

  const kvNamespaceId = await createKvNamespace(client, account, title);
  const subdomain = await ensureWorkersSubdomain(client, accountId);
  await uploadWorker(client, { accountId, workerName, script, kvNamespaceId, withMigrations: true });

  const ownerSecret = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(OWNER_SECRET_BYTES)));
  const turnKey = await createTurnKey(client, accountId, title);
  const secrets = { OWNER_SECRET: ownerSecret, TURN_KEY_ID: turnKey.uid, TURN_KEY_SECRET: turnKey.secret };
  for (const [name, text] of Object.entries(secrets)) {
    await client.call("PUT", `${account}/workers/scripts/${workerName}/secrets`, { name, text, type: "secret_text" });
  }
  await client.call("POST", `${account}/workers/scripts/${workerName}/subdomain`, { enabled: true, previews_enabled: false });

  const relayUrl = `https://${workerName}.${subdomain}.workers.dev`;
  await logger.log("INFO", "relay.deploy", "Relay deployed", { relayUrl, kvNamespaceId, turnKeyId: turnKey.uid });
  return { relayUrl, ownerSecret, kvNamespaceId, turnKeyId: turnKey.uid };
}

/** Reuses the namespace with this title so a retried deploy does not leave a second one behind. */
async function createKvNamespace(client: CloudflareClient, account: string, title: string): Promise<string> {
  const existing = await client.call("GET", `${account}/storage/kv/namespaces?per_page=100`);
  const match = Array.isArray(existing) ? (existing as { id?: unknown; title?: unknown }[]).find((item) => item.title === title) : undefined;
  if (typeof match?.id === "string") { return match.id; }
  const result = await client.call("POST", `${account}/storage/kv/namespaces`, { title });
  const id = typeof result === "object" && result !== null ? (result as { id?: unknown }).id : undefined;
  if (typeof id !== "string") { throw new Error("Cloudflare created the KV namespace but did not return its id."); }
  return id;
}
