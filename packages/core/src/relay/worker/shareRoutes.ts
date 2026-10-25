// Serves the owner's share endpoints from KV: public reads of the manifest and blobs, owner-only checks, writes and deletes.

import { isSha256Hex, isShareId } from "../http/index.js";
import { SHARE_PATH } from "../../share/http/index.js";
import type { KvNamespace, RelayEnv } from "./cloudflareRuntime.js";
import { bytesAnswer, noContent, notFound, refuse } from "./httpAnswers.js";
import { carriesOwnerSecret } from "./checkOwner.js";
import { sha256Hex } from "./hashSecret.js";

// CONTRACT: documents/contracts/share-link.md#worker-endpoints
const KV_VALUE_LIMIT = 25 * 1024 * 1024;

interface Target { shareId: string; key: string; blobHash?: string }

const manifestKey = (shareId: string): string => `share:${shareId}:manifest`;

/** Undefined for a path that is no share endpoint; `"malformed"` for one with a bad id or hash. */
function parseTarget(pathname: string): Target | "malformed" | undefined {
  const [shareId, kind, hash, extra] = pathname.slice(SHARE_PATH.prefix.length).split("/");
  const isManifest = kind === "manifest" && hash === undefined;
  const isBlob = kind === "blob" && hash !== undefined && extra === undefined;
  if (!isManifest && !isBlob) { return undefined; }
  if (!isShareId(shareId) || (isBlob && !isSha256Hex(hash))) { return "malformed"; }
  return isBlob ? { shareId, key: `blob:${hash}`, blobHash: hash } : { shareId, key: manifestKey(shareId) };
}

async function exists(kv: KvNamespace, key: string): Promise<boolean> {
  const stream = await kv.get(key, "stream");
  await stream?.cancel();
  return stream !== null;
}

async function read(env: RelayEnv, target: Target): Promise<Response> {
  // A blob is readable only while its share's manifest exists, so a revoked link reads nothing.
  if (target.blobHash !== undefined && !(await exists(env.KV, manifestKey(target.shareId)))) { return notFound(); }
  const stream = await env.KV.get(target.key, "stream");
  return stream ? bytesAnswer(stream) : notFound();
}

async function write(request: Request, env: RelayEnv, target: Target): Promise<Response> {
  if (Number(request.headers.get("Content-Length")) > KV_VALUE_LIMIT) { return refuse("tooLarge"); }
  const body = await request.arrayBuffer();
  if (body.byteLength > KV_VALUE_LIMIT) { return refuse("tooLarge"); }
  if (target.blobHash !== undefined && (await sha256Hex(new Uint8Array(body))) !== target.blobHash) { return refuse("malformed"); }
  await env.KV.put(target.key, body);
  return noContent();
}

export async function handleShareRequest(request: Request, env: RelayEnv, pathname: string): Promise<Response> {
  const target = parseTarget(pathname);
  if (!target) { return notFound(); }
  if (target === "malformed") { return refuse("malformed"); }
  const { method } = request;
  if (method === "GET") { return read(env, target); }
  const isBlob = target.blobHash !== undefined;
  if (method !== "PUT" && method !== "DELETE" && !(method === "HEAD" && isBlob)) { return notFound(); }
  if (!(await carriesOwnerSecret(request, env, "share"))) { return refuse("unauthorized"); }
  if (method === "PUT") { return write(request, env, target); }
  if (method === "HEAD") { return (await exists(env.KV, target.key)) ? bytesAnswer(null) : notFound(); }
  await env.KV.delete(target.key);
  return noContent();
}
