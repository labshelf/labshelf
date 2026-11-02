// Calls the Cloudflare API with the owner's token and reads, and waits for, the Worker build a relay serves.

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

export interface DeployedWorkerVersion {
  build: WorkerBuild;
  /** The last Durable Object migration the Worker has applied; undefined when it reports none. */
  migrationTag: string | undefined;
}

// CONTRACT: documents/contracts/relay.md#versions
/** Reads the public /version of a relay; throws with context when it does not answer a build. */
export async function fetchWorkerVersion(relayUrl: string, doFetch: typeof fetch, logger: ILogger): Promise<DeployedWorkerVersion> {
  const url = `${relayUrl.replace(/\/+$/, "")}${RELAY_PATH.version}`;
  try {
    const response = await doFetch(url, { method: "GET" });
    if (!response.ok) { throw new Error(`status ${response.status}`); }
    const body: unknown = await response.json();
    const worker = isRecord(body) ? body.worker : undefined;
    const build = typeof worker === "string" ? parseWorkerBuild(worker) : undefined;
    if (!build) { throw new Error("the answer has no valid worker build"); }
    const tag = isRecord(body) ? body.migrationTag : undefined;
    return { build, migrationTag: typeof tag === "string" ? tag : undefined };
  } catch (error) {
    const reason = formatError(error);
    await logger.log("WARN", "relay.deploy", "Relay /version unreadable", { url, error: reason });
    throw new Error(`Could not read the relay's version at ${url}: ${reason}`, { cause: error });
  }
}

export const formatWorkerBuild = (build: WorkerBuild): string => `${build.major}.${build.minor}.${build.patch}`;

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

/** Resolves when `/version` answers; throws when the timeout passes. Each failed poll is logged by `fetchWorkerVersion`. */
export async function assertRelayServing({ relayUrl, fetch: doFetch, logger, clock, timeoutMs = DEFAULT_TIMEOUT_MS }: WaitForRelayOptions): Promise<void> {
  const deadline = clock.now() + timeoutMs;
  let delay = FIRST_DELAY_MS;
  for (;;) {
    try {
      await fetchWorkerVersion(relayUrl, doFetch, logger);
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
