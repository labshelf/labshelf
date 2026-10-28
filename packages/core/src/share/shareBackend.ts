// The ports through which shares reach the owner's Worker (owner writes, and the public reads of the share page), the share request error, the HTTP client that implements the ports, and the account-bound backend that refuses a share living on another relay.
import { decodeRefusal, SHARE_PATH, type RelayAccount } from "../relay/index.js";

// CONTRACT: documents/contracts/share-link.md#worker-endpoints
export interface ShareBackend {
  putManifest(shareId: string, bytes: Uint8Array): Promise<void>;
  putBlob(shareId: string, hash: string, bytes: Uint8Array): Promise<void>;
  hasBlob(shareId: string, hash: string): Promise<boolean>;
  /** Succeeds also when nothing is stored, so a revoke can repeat. */
  deleteManifest(shareId: string): Promise<void>;
  deleteBlob(shareId: string, hash: string): Promise<void>;
}

/** Undefined means the Worker holds no such manifest or blob; any other failure rejects. */
export interface ShareReader {
  fetchManifest(shareId: string): Promise<Uint8Array | undefined>;
  fetchBlob(shareId: string, hash: string): Promise<Uint8Array | undefined>;
}

/** `code` is a relay refusal code, `incompatibleRelay`, `malformed` for an unreadable answer, or `network`. */
export class ShareRequestError extends Error {
  constructor(readonly code: string, readonly status: number, detail: string) {
    super(`Share request failed (${code}): ${detail}`);
    this.name = "ShareRequestError";
  }
}

export interface WorkerShareBackendOptions { relayUrl: string; ownerSecret: string; fetch?: typeof fetch }
export interface WorkerShareReaderOptions { relayUrl: string; fetch?: typeof fetch }

interface Call { method: "GET" | "HEAD" | "PUT" | "DELETE"; path: string; ownerSecret?: string; body?: Uint8Array }

async function send(doFetch: typeof fetch, relayUrl: string, call: Call): Promise<Response> {
  const init: RequestInit = { method: call.method };
  if (call.ownerSecret !== undefined) { init.headers = { authorization: `Bearer ${call.ownerSecret}` }; }
  if (call.body) { init.body = call.body as Uint8Array<ArrayBuffer>; }
  try {
    return await doFetch(`${relayUrl.replace(/\/+$/, "")}${call.path}`, init);
  } catch (error) {
    throw new ShareRequestError("network", 0, `${call.method} ${call.path}: ${String(error)}`);
  }
}

async function refusal(response: Response, call: Call): Promise<ShareRequestError> {
  const where = `${call.method} ${call.path}`;
  const json: unknown = await response.json().catch(() => undefined);
  const decoded = decodeRefusal(json);
  if (decoded.ok) { return new ShareRequestError(decoded.value.error, response.status, `${where} refused`); }
  const detail = decoded.error === "incompatibleRelay" ? `${where}: the relay speaks ${decoded.worker}` : `${where}: unreadable answer`;
  return new ShareRequestError(decoded.error, response.status, detail);
}

async function expectOk(doFetch: typeof fetch, relayUrl: string, call: Call): Promise<void> {
  const response = await send(doFetch, relayUrl, call);
  if (!response.ok) { throw await refusal(response, call); }
}

/** Undefined on 404; a HEAD answers an empty body. */
async function readBytes(doFetch: typeof fetch, relayUrl: string, call: Call): Promise<Uint8Array | undefined> {
  const response = await send(doFetch, relayUrl, call);
  if (response.status === 404) { return undefined; }
  if (!response.ok) { throw await refusal(response, call); }
  return call.method === "HEAD" ? new Uint8Array(0) : new Uint8Array(await response.arrayBuffer());
}

// CONTRACT: documents/contracts/share-link.md#worker-endpoints
export function createWorkerShareBackend({ relayUrl, ownerSecret, fetch: doFetch = fetch }: WorkerShareBackendOptions): ShareBackend {
  return {
    putManifest: (shareId, body) => expectOk(doFetch, relayUrl, { method: "PUT", path: SHARE_PATH.manifest(shareId), ownerSecret, body }),
    putBlob: (shareId, hash, body) => expectOk(doFetch, relayUrl, { method: "PUT", path: SHARE_PATH.blob(shareId, hash), ownerSecret, body }),
    hasBlob: async (shareId, hash) =>
      (await readBytes(doFetch, relayUrl, { method: "HEAD", path: SHARE_PATH.blob(shareId, hash), ownerSecret })) !== undefined,
    deleteManifest: (shareId) => expectOk(doFetch, relayUrl, { method: "DELETE", path: SHARE_PATH.manifest(shareId), ownerSecret }),
    deleteBlob: (shareId, hash) => expectOk(doFetch, relayUrl, { method: "DELETE", path: SHARE_PATH.blob(shareId, hash), ownerSecret }),
  };
}

export function createWorkerShareReader({ relayUrl, fetch: doFetch = fetch }: WorkerShareReaderOptions): ShareReader {
  return {
    fetchManifest: (shareId) => readBytes(doFetch, relayUrl, { method: "GET", path: SHARE_PATH.manifest(shareId) }),
    fetchBlob: (shareId, hash) => readBytes(doFetch, relayUrl, { method: "GET", path: SHARE_PATH.blob(shareId, hash) }),
  };
}

/** A share made with another account cannot be written or revoked from here, so asking for its relay throws, naming it. */
export function resolveRelayBackend(account: RelayAccount | undefined): (relayUrl: string) => ShareBackend {
  return (relayUrl) => {
    if (account?.relayUrl !== relayUrl) { throw new Error(`the link lives on ${new URL(relayUrl).host}, a relay this device is not connected to`); }
    return createWorkerShareBackend({ relayUrl, ownerSecret: account.ownerSecret });
  };
}
