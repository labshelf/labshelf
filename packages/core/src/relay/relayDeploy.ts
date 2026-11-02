// Deploys, updates and removes the relay Worker and the share Worker through the Cloudflare API client.

import { bytesToBase64Url, bytesToHex } from "../encoding/index.js";
import type { ILogger } from "../ports/index.js";
import {
  CloudflareApiError, compareWorkerBuilds, createCloudflareClient, fetchWorkerVersion, formatWorkerBuild, parseWorkerBuild,
  type CloudflareClient,
} from "./relayClient.js";
import { RELAY_MIGRATIONS, type RelayMigration } from "./relayPaths.js";

const COMPATIBILITY_DATE = "2026-10-01";
const SCRIPT_FILE = "worker.js";

interface WorkerUpload {
  accountId: string; workerName: string; script: string; kvNamespaceId: string;
  /** The relay Worker binds the `Room` Durable Object; the share Worker binds only its KV. */
  room: boolean;
  /** The steps the Worker has not applied yet; empty keeps its classes as they are. */
  migrations: readonly RelayMigration[];
  /** The tag the Worker is on; undefined for a new Worker. */
  fromTag: string | undefined;
}

/** Cloudflare's multi-step migration form: from the deployed tag to the last step's, each step without its tag. */
function migrationsField(pending: readonly RelayMigration[], fromTag: string | undefined): Record<string, unknown> {
  const last = pending.at(-1);
  if (!last) { return {}; }
  const steps = pending.map(({ tag: _tag, ...step }) => step);
  return { migrations: { ...(fromTag === undefined ? {} : { old_tag: fromTag }), new_tag: last.tag, steps } };
}

/** Every upload keeps the secrets and the Durable Object data; only the pending migration steps go with it. */
function workerMetadata(upload: WorkerUpload): Record<string, unknown> {
  return {
    main_module: SCRIPT_FILE,
    compatibility_date: COMPATIBILITY_DATE,
    bindings: [
      ...(upload.room ? [
        { type: "durable_object_namespace", name: "ROOM", class_name: "Room" },
        { type: "durable_object_namespace", name: "INBOX", class_name: "Inbox" },
      ] : []),
      { type: "kv_namespace", name: "KV", namespace_id: upload.kvNamespaceId },
    ],
    keep_bindings: ["secret_text"],
    ...migrationsField(upload.migrations, upload.fromTag),
  };
}

async function uploadWorker(client: CloudflareClient, upload: WorkerUpload): Promise<void> {
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(workerMetadata(upload))], { type: "application/json" }));
  form.append(SCRIPT_FILE, new Blob([upload.script], { type: "application/javascript+module" }), SCRIPT_FILE);
  await client.call("PUT", `/accounts/${upload.accountId}/workers/scripts/${upload.workerName}`, form);
}

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
// The titles do not carry the random names, so a retried connect, which draws new names, still finds the namespaces.
const KV_TITLE = "labshelf-relay";
const SHARE_KV_TITLE = "labshelf-share";

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
  /** The Worker's script name, which also names its address. */
  workerName: string;
  relayUrl: string;
  /** Kept on the owner's devices only: it authorises `/claim`. */
  ownerSecret: string;
  kvNamespaceId: string;
}

/** The share Worker of an account: it serves the paper share links and is never rotated ([Deploy](relay.md#deploy)). */
export interface ShareWorker {
  /** The Worker's script name, which also names its address. */
  name: string;
  url: string;
  /** Kept on the owner's devices only: it authorises the share writes and deletes. */
  ownerSecret: string;
  kvNamespaceId: string;
}

interface WorkerDeploy { accountId: string; workerName: string; script: string; kvTitle: string; room: boolean }

/** Creates or reuses the KV namespace, uploads the script with every migration, sets a new owner secret and enables its address. */
async function deployWorker(client: CloudflareClient, deploy: WorkerDeploy): Promise<{ url: string; ownerSecret: string; kvNamespaceId: string }> {
  const { accountId, workerName, script, room } = deploy;
  const account = `/accounts/${accountId}`;
  const kvNamespaceId = await createKvNamespace(client, account, deploy.kvTitle);
  const subdomain = await ensureWorkersSubdomain(client, accountId);
  // A new Worker applies every step; the share Worker has no Durable Object, so it has none.
  const migrations = room ? RELAY_MIGRATIONS : [];
  await uploadWorker(client, { accountId, workerName, script, kvNamespaceId, room, migrations, fromTag: undefined });
  const ownerSecret = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(OWNER_SECRET_BYTES)));
  await client.call("PUT", `${account}/workers/scripts/${workerName}/secrets`, { name: "OWNER_SECRET", text: ownerSecret, type: "secret_text" });
  await client.call("POST", `${account}/workers/scripts/${workerName}/subdomain`, { enabled: true, previews_enabled: false });
  return { url: `https://${workerName}.${subdomain}.workers.dev`, ownerSecret, kvNamespaceId };
}

export async function deployRelay(options: DeployRelayOptions): Promise<DeployedRelay> {
  const { token, accountId, script, workerName, logger } = options;
  const client = createCloudflareClient({ token, fetch: options.fetch, logger });
  await logger.log("INFO", "relay.deploy", "Deploying relay", { accountId, workerName });
  const { url: relayUrl, ownerSecret, kvNamespaceId } = await deployWorker(client, { accountId, workerName, script, kvTitle: KV_TITLE, room: true });
  await logger.log("INFO", "relay.deploy", "Relay deployed", { relayUrl, kvNamespaceId });
  return { workerName, relayUrl, ownerSecret, kvNamespaceId };
}

export interface DeployShareWorkerOptions {
  token: string;
  accountId: string;
  /** The bundled share Worker source. */
  script: string;
  name: string;
  logger: ILogger;
  fetch: typeof fetch;
}

// CONTRACT: documents/contracts/relay.md#deploy
/** Deploys the separate share Worker with its own name, KV namespace and owner secret. */
export async function deployShareWorker(options: DeployShareWorkerOptions): Promise<ShareWorker> {
  const { token, accountId, script, name, logger } = options;
  const client = createCloudflareClient({ token, fetch: options.fetch, logger });
  await logger.log("INFO", "relay.deploy", "Deploying share Worker", { accountId, name });
  const deployed = await deployWorker(client, { accountId, workerName: name, script, kvTitle: SHARE_KV_TITLE, room: false });
  await logger.log("INFO", "relay.deploy", "Share Worker deployed", { url: deployed.url, kvNamespaceId: deployed.kvNamespaceId });
  return { name, ...deployed };
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

export interface UpdateRelayOptions {
  relayUrl: string;
  /** The `<major>.<minor>.<patch>` build of the bundled script. */
  bundledVersion: string;
  /** Asked only when the relay needs the update, so a current relay costs no token refresh. */
  accessToken(): Promise<string>;
  accountId: string;
  script: string;
  workerName: string;
  kvNamespaceId: string;
  /** The bundled migration steps; defaults to `RELAY_MIGRATIONS`. */
  migrations?: readonly RelayMigration[];
  logger: ILogger;
  fetch: typeof fetch;
}

/** The steps after `fromTag`; all of them when the Worker reports none. Throws on a tag the list does not have. */
function pendingMigrations(migrations: readonly RelayMigration[], fromTag: string | undefined): readonly RelayMigration[] {
  if (fromTag === undefined) { return migrations; }
  const index = migrations.findIndex((step) => step.tag === fromTag);
  if (index < 0) { throw new Error(`The relay reports the migration "${fromTag}", which this LabShelf does not know; update LabShelf.`); }
  return migrations.slice(index + 1);
}

export type RelayUpdateOutcome = "updated" | "current" | "deployedNewer";

/** Reads the public /version first, so a current relay costs no API call; an update sends the migration steps after the deployed tag. */
export async function updateRelayIfOlder(options: UpdateRelayOptions): Promise<RelayUpdateOutcome> {
  const { relayUrl, bundledVersion, logger } = options;
  const bundled = parseWorkerBuild(bundledVersion);
  if (!bundled) { throw new Error(`The bundled relay version "${bundledVersion}" is not major.minor.patch.`); }
  const { build: deployed, migrationTag } = await fetchWorkerVersion(relayUrl, options.fetch, logger);
  const order = compareWorkerBuilds(deployed, bundled);
  const versions = { relayUrl, deployed: formatWorkerBuild(deployed), bundled: bundledVersion };
  if (order > 0) {
    await logger.log("INFO", "relay.deploy", "Deployed relay is newer than the bundled one; leaving it", versions);
    return "deployedNewer";
  }
  if (order === 0) { return "current"; }
  const migrations = pendingMigrations(options.migrations ?? RELAY_MIGRATIONS, migrationTag);
  await logger.log("INFO", "relay.deploy", "Updating relay", { ...versions, migrationTag, migrations: migrations.map((step) => step.tag) });
  const client = createCloudflareClient({ token: await options.accessToken(), fetch: options.fetch, logger });
  const { accountId, workerName, script, kvNamespaceId } = options;
  await uploadWorker(client, { accountId, workerName, script, kvNamespaceId, room: true, migrations, fromTag: migrationTag });
  return "updated";
}

export interface RemoveRelayOptions {
  token: string;
  accountId: string;
  workerName: string;
  /** The relay's KV namespace; left out when another relay still binds it, as a rotated relay's replacement does. */
  kvNamespaceId?: string;
  /** The account's share Worker, deleted with its KV namespace beside the relay. */
  shareWorker?: Pick<ShareWorker, "name" | "kvNamespaceId">;
  logger: ILogger;
  fetch: typeof fetch;
}

/** Tries every deletion, treats a missing resource as deleted and throws the first other failure afterwards. */
export async function removeRelay(options: RemoveRelayOptions): Promise<void> {
  const { accountId, workerName, kvNamespaceId, shareWorker, logger } = options;
  const client = createCloudflareClient({ token: options.token, fetch: options.fetch, logger });
  const account = `/accounts/${accountId}`;
  await logger.log("INFO", "relay.deploy", "Deleting relay", { accountId, workerName, kvNamespaceId, shareWorker: shareWorker?.name });
  const workers: { name: string; kvNamespaceId: string | undefined }[] = [{ name: workerName, kvNamespaceId }, ...(shareWorker ? [shareWorker] : [])];
  const steps = workers.flatMap((worker) => [
    () => client.call("DELETE", `${account}/workers/scripts/${worker.name}?force=true`),
    ...(worker.kvNamespaceId === undefined ? [] : [() => client.call("DELETE", `${account}/storage/kv/namespaces/${worker.kvNamespaceId}`)]),
  ]);
  let firstFailure: unknown;
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      if (error instanceof CloudflareApiError && error.status === 404) { continue; }
      firstFailure ??= error;
    }
  }
  if (firstFailure !== undefined) { throw firstFailure; }
  await logger.log("INFO", "relay.deploy", "Relay deleted", { workerName });
}
