// Deploys the relay Worker into an owner's Cloudflare account: KV, address, script, secrets and route.
import { bytesToBase64Url, bytesToHex } from "../../encoding/index.js";
import type { ILogger } from "../../ports/index.js";
import { createCloudflareClient, type CloudflareClient } from "./cloudflareClient.js";
import { uploadWorker } from "./workerUpload.js";
import { CloudflareApiError } from "./cloudflareError.js";

const NO_SUBDOMAIN_CODE = 10007;

/** Returns the account's subdomain; a fresh account has none (404, code 10007), so one derived from its id is created. */
async function ensureWorkersSubdomain(client: CloudflareClient, accountId: string): Promise<string> {
  const path = `/accounts/${accountId}/workers/subdomain`;
  try {
    const existing = subdomainOf(await client.call("GET", path));
    if (existing) { return existing; }
  } catch (error) {
    if (!(error instanceof CloudflareApiError) || error.code !== NO_SUBDOMAIN_CODE) { throw error; }
  }
  const created = subdomainOf(await putSubdomain(client, path, accountId));
  if (!created) { throw new Error("Cloudflare created the workers.dev subdomain but did not report its name."); }
  return created;
}

// A taken name is refused with 400 or 409; one retry with a random suffix avoids a second collision.
async function putSubdomain(client: CloudflareClient, path: string, accountId: string): Promise<unknown> {
  const name = derivedSubdomain(accountId);
  try {
    return await client.call("PUT", path, { subdomain: name });
  } catch (error) {
    if (!(error instanceof CloudflareApiError) || (error.status !== 400 && error.status !== 409)) { throw error; }
    const suffix = bytesToHex(crypto.getRandomValues(new Uint8Array(3)));
    return client.call("PUT", path, { subdomain: `${name}-${suffix}` });
  }
}

/** A DNS label of at most 63 characters, made of lowercase letters, digits and hyphens. */
function derivedSubdomain(accountId: string): string {
  return `labshelf-${accountId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12)}`;
}

function subdomainOf(result: unknown): string | undefined {
  const value = typeof result === "object" && result !== null ? (result as { subdomain?: unknown }).subdomain : undefined;
  return typeof value === "string" && value !== "" ? value : undefined;
}

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
  await client.call("PUT", `${account}/workers/scripts/${workerName}/secrets`, { name: "OWNER_SECRET", text: ownerSecret, type: "secret_text" });
  await client.call("POST", `${account}/workers/scripts/${workerName}/subdomain`, { enabled: true, previews_enabled: false });

  const relayUrl = `https://${workerName}.${subdomain}.workers.dev`;
  await logger.log("INFO", "relay.deploy", "Relay deployed", { relayUrl, kvNamespaceId });
  return { relayUrl, ownerSecret, kvNamespaceId };
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
