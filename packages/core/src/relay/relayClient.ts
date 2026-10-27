// Calls the Cloudflare API with the owner's token and deploys, updates, waits for and removes the relay Worker through it.

import { bytesToBase64Url, bytesToHex } from "../encoding/index.js";
import { formatError } from "../errors/index.js";
import { isRecord } from "../guards/index.js";
import type { ILogger } from "../ports/index.js";
import { RELAY_PATH } from "./relayPaths.js";

const AUTH_CODES = new Set([1000, 6003, 6111, 10000]);

export class CloudflareApiError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    /** HTTP status, or 0 when Cloudflare could not be reached. */
    readonly status: number,
    /** The first `errors[].code` of the response, or 0 when there is none. */
    readonly code: number,
    readonly cloudflareMessage: string,
  ) {
    super(describe(method, path, status, code, cloudflareMessage));
    this.name = "CloudflareApiError";
  }
}

function describe(method: string, path: string, status: number, code: number, message: string): string {
  if (status === 0) { return `Could not reach Cloudflare (${method} ${path}): ${message}`; }
  if (status === 401 || AUTH_CODES.has(code)) {
    return `Cloudflare rejected the API token (${message}). Create it again from the LabShelf template and paste it whole.`;
  }
  if (code === 10063) { return "The account has no workers.dev subdomain, so the relay cannot get an address."; }
  if (status === 403) {
    return `The API token lacks a permission for ${method} ${path} (${message}). Create it again from the LabShelf template.`;
  }
  return `Cloudflare failed ${method} ${path} (status ${status}, code ${code}): ${message}`;
}

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const LOG_MODULE = "relay.deploy";

export interface CloudflareClientOptions { token: string; fetch: typeof fetch; logger: ILogger }

export interface CloudflareClient {
  /** Resolves with the response's `result` (the whole body when it has none); `body` is JSON, or FormData sent as multipart. */
  call(method: string, path: string, body?: unknown): Promise<unknown>;
}

export function createCloudflareClient({ token, fetch: doFetch, logger }: CloudflareClientOptions): CloudflareClient {
  return {
    async call(method, path, body) {
      // TRAP: the headers and body carry the token and secrets, so only method, path and status reach the log.
      const init = requestInit(method, token, body);
      let response: Response;
      try {
        response = await doFetch(`${CLOUDFLARE_API}${path}`, init);
      } catch (error) {
        const failure = new CloudflareApiError(method, path, 0, 0, formatError(error));
        await logger.log("ERROR", LOG_MODULE, "Cloudflare API unreachable", { method, path, error: failure.cloudflareMessage });
        throw failure;
      }
      const parsed = await readJson(response);
      const failure = failureOf(method, path, response, parsed);
      if (failure) {
        await logger.log("ERROR", LOG_MODULE, "Cloudflare API call failed", { method, path, status: failure.status, code: failure.code, error: failure.cloudflareMessage });
        throw failure;
      }
      await logger.log("INFO", LOG_MODULE, "Cloudflare API call", { method, path, status: response.status });
      return isRecord(parsed) && "result" in parsed ? parsed.result : parsed;
    },
  };
}

// FormData sets its own multipart Content-Type with the boundary.
function requestInit(method: string, token: string, body: unknown): RequestInit {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body === undefined) { return { method, headers }; }
  if (body instanceof FormData) { return { method, headers, body }; }
  return { method, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return text; }
}

function failureOf(method: string, path: string, response: Response, parsed: unknown): CloudflareApiError | undefined {
  const errors = isRecord(parsed) && Array.isArray(parsed.errors) ? parsed.errors : [];
  const first: unknown = errors[0];
  const code = isRecord(first) && typeof first.code === "number" ? first.code : 0;
  const message = isRecord(first) && typeof first.message === "string" ? first.message : undefined;
  const refused = isRecord(parsed) && parsed.success === false;
  if (response.ok && !refused) { return undefined; }
  const fallback = typeof parsed === "string" && parsed !== "" ? parsed.slice(0, 200) : response.statusText || "no details";
  return new CloudflareApiError(method, path, response.status, code, message ?? fallback);
}

export interface CloudflareAccount { id: string; name: string }

/**
 * Throws a `CloudflareApiError` when Cloudflare refuses the token or it is no longer active.
 * An account-owned token fails the user endpoint, so a refusal falls back to listing accounts: a list means a valid token.
 */
export async function verifyCloudflareToken(client: CloudflareClient): Promise<void> {
  try {
    await verifyUserToken(client);
  } catch (error) {
    if (!(error instanceof CloudflareApiError) || (error.status !== 401 && error.status !== 403)) { throw error; }
    if ((await listCloudflareAccounts(client).catch(() => [])).length === 0) { throw error; }
  }
}

async function verifyUserToken(client: CloudflareClient): Promise<void> {
  const result = await client.call("GET", "/user/tokens/verify");
  const status = isRecord(result) ? result.status : undefined;
  if (status !== "active") {
    throw new CloudflareApiError("GET", "/user/tokens/verify", 401, 0, `the token is ${typeof status === "string" ? status : "not active"}`);
  }
}

/** The accounts the token reaches; the caller picks when there are several. */
export async function listCloudflareAccounts(client: CloudflareClient): Promise<CloudflareAccount[]> {
  const result = await client.call("GET", "/accounts");
  if (!Array.isArray(result)) { return []; }
  return result.flatMap((item: unknown) =>
    isRecord(item) && typeof item.id === "string" ? [{ id: item.id, name: typeof item.name === "string" ? item.name : item.id }] : []);
}

const COMPATIBILITY_DATE = "2026-10-01";
const SCRIPT_FILE = "worker.js";

interface WorkerUpload { accountId: string; workerName: string; script: string; kvNamespaceId: string; withMigrations: boolean }

/** Migrations go only on the first upload: they create the Room class; later uploads keep its data and the secrets. */
function workerMetadata(kvNamespaceId: string, withMigrations: boolean): Record<string, unknown> {
  return {
    main_module: SCRIPT_FILE,
    compatibility_date: COMPATIBILITY_DATE,
    bindings: [
      { type: "durable_object_namespace", name: "ROOM", class_name: "Room" },
      { type: "kv_namespace", name: "KV", namespace_id: kvNamespaceId },
    ],
    keep_bindings: ["secret_text"],
    ...(withMigrations ? { migrations: { new_tag: "v1", new_sqlite_classes: ["Room"] } } : {}),
  };
}

async function uploadWorker(client: CloudflareClient, upload: WorkerUpload): Promise<void> {
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(workerMetadata(upload.kvNamespaceId, upload.withMigrations))], { type: "application/json" }));
  form.append(SCRIPT_FILE, new Blob([upload.script], { type: "application/javascript+module" }), SCRIPT_FILE);
  await client.call("PUT", `/accounts/${upload.accountId}/workers/scripts/${upload.workerName}`, form);
}

/** A Worker build `<major>.<minor>.<patch>`: the protocol version it serves and a counter that grows with every bundle. */
export interface WorkerBuild { major: number; minor: number; patch: number }

const BUILD_PATTERN = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

export function parseWorkerBuild(text: string): WorkerBuild | undefined {
  const match = BUILD_PATTERN.exec(text);
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : undefined;
}

/** Negative when `a` is older than `b`, positive when newer, 0 when equal; compares major, then minor, then patch. */
export function compareWorkerBuilds(a: WorkerBuild, b: WorkerBuild): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** Reads the public /version of a relay; throws with context when it does not answer a build. */
async function fetchWorkerBuild(relayUrl: string, doFetch: typeof fetch, logger: ILogger): Promise<WorkerBuild> {
  const url = `${relayUrl.replace(/\/+$/, "")}${RELAY_PATH.version}`;
  try {
    const response = await doFetch(url, { method: "GET" });
    if (!response.ok) { throw new Error(`status ${response.status}`); }
    const body: unknown = await response.json();
    const worker = typeof body === "object" && body !== null ? (body as { worker?: unknown }).worker : undefined;
    const build = typeof worker === "string" ? parseWorkerBuild(worker) : undefined;
    if (!build) { throw new Error("the answer has no valid worker build"); }
    return build;
  } catch (error) {
    const reason = formatError(error);
    await logger.log("WARN", "relay.deploy", "Relay /version unreadable", { url, error: reason });
    throw new Error(`Could not read the relay's version at ${url}: ${reason}`, { cause: error });
  }
}

const formatWorkerBuild = (build: WorkerBuild): string => `${build.major}.${build.minor}.${build.patch}`;

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

export interface RelayClock { now(): number; sleep(ms: number): Promise<void> }

export interface WaitForRelayOptions {
  relayUrl: string;
  fetch: typeof fetch;
  logger: ILogger;
  clock: RelayClock;
  /** Gives up after this long; a new account subdomain needs 90 to 130 s before TLS answers. */
  timeoutMs?: number;
}

const FIRST_DELAY_MS = 5_000;
const MAX_DELAY_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 240_000;

/** Resolves when `/version` answers; throws when the timeout passes. Each failed poll is logged by `fetchWorkerBuild`. */
export async function assertRelayServing({ relayUrl, fetch: doFetch, logger, clock, timeoutMs = DEFAULT_TIMEOUT_MS }: WaitForRelayOptions): Promise<void> {
  const deadline = clock.now() + timeoutMs;
  let delay = FIRST_DELAY_MS;
  for (;;) {
    try {
      await fetchWorkerBuild(relayUrl, doFetch, logger);
      await logger.log("INFO", "relay.deploy", "Relay is serving", { relayUrl });
      return;
    } catch (error) {
      if (clock.now() + delay > deadline) {
        throw new Error(`The relay at ${relayUrl} did not answer within ${Math.round(timeoutMs / 1000)} s.`, { cause: error });
      }
    }
    await clock.sleep(delay);
    delay = Math.min(delay * 1.5, MAX_DELAY_MS);
  }
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
  logger: ILogger;
  fetch: typeof fetch;
}

export type RelayUpdateOutcome = "updated" | "current" | "deployedNewer";

/** Reads the public /version first, so a current relay costs no API call. */
export async function updateRelayIfOlder(options: UpdateRelayOptions): Promise<RelayUpdateOutcome> {
  const { relayUrl, bundledVersion, logger } = options;
  const bundled = parseWorkerBuild(bundledVersion);
  if (!bundled) { throw new Error(`The bundled relay version "${bundledVersion}" is not major.minor.patch.`); }
  const deployed = await fetchWorkerBuild(relayUrl, options.fetch, logger);
  const order = compareWorkerBuilds(deployed, bundled);
  const versions = { relayUrl, deployed: formatWorkerBuild(deployed), bundled: bundledVersion };
  if (order > 0) {
    await logger.log("INFO", "relay.deploy", "Deployed relay is newer than the bundled one; leaving it", versions);
    return "deployedNewer";
  }
  if (order === 0) { return "current"; }
  await logger.log("INFO", "relay.deploy", "Updating relay", versions);
  const client = createCloudflareClient({ token: await options.accessToken(), fetch: options.fetch, logger });
  const { accountId, workerName, script, kvNamespaceId } = options;
  await uploadWorker(client, { accountId, workerName, script, kvNamespaceId, withMigrations: false });
  return "updated";
}

export interface RemoveRelayOptions {
  token: string;
  accountId: string;
  workerName: string;
  kvNamespaceId: string;
  logger: ILogger;
  fetch: typeof fetch;
}

/** Tries both deletions, treats a missing resource as deleted and throws the first other failure afterwards. */
export async function removeRelay(options: RemoveRelayOptions): Promise<void> {
  const { accountId, workerName, kvNamespaceId, logger } = options;
  const client = createCloudflareClient({ token: options.token, fetch: options.fetch, logger });
  const account = `/accounts/${accountId}`;
  await logger.log("INFO", "relay.deploy", "Deleting relay", { accountId, workerName });
  const steps = [
    () => client.call("DELETE", `${account}/workers/scripts/${workerName}?force=true`),
    () => client.call("DELETE", `${account}/storage/kv/namespaces/${kvNamespaceId}`),
  ];
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
