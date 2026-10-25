// Serves the owner's share endpoints from KV: public reads of the manifest and blobs, owner-only checks, writes and deletes.

import { isSha256Hex, isShareId } from "../http/index.js";
import { SHARE_PATH } from "../../share/http/index.js";
import type { KvNamespace, RelayEnv } from "./cloudflareRuntime.js";
import { createBytesAnswer, createNoContentAnswer, createNotFoundAnswer, createRefusal } from "./httpAnswers.js";
import { checkOwnerSecret } from "./checkOwner.js";
import { deriveSecretSha256 } from "./hashSecret.js";

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
  if (target.blobHash !== undefined && !(await exists(env.KV, manifestKey(target.shareId)))) { return createNotFoundAnswer(); }
  const stream = await env.KV.get(target.key, "stream");
  return stream ? createBytesAnswer(stream) : createNotFoundAnswer();
}

async function write(request: Request, env: RelayEnv, target: Target): Promise<Response> {
  if (Number(request.headers.get("Content-Length")) > KV_VALUE_LIMIT) { return createRefusal("tooLarge"); }
  const body = await request.arrayBuffer();
  if (body.byteLength > KV_VALUE_LIMIT) { return createRefusal("tooLarge"); }
  if (target.blobHash !== undefined && (await deriveSecretSha256(new Uint8Array(body))) !== target.blobHash) { return createRefusal("malformed"); }
  await env.KV.put(target.key, body);
  return createNoContentAnswer();
}

export async function answerShareRequest(request: Request, env: RelayEnv, pathname: string): Promise<Response> {
  const target = parseTarget(pathname);
  if (!target) { return createNotFoundAnswer(); }
  if (target === "malformed") { return createRefusal("malformed"); }
  const { method } = request;
  if (method === "GET") { return read(env, target); }
  const isBlob = target.blobHash !== undefined;
  if (method !== "PUT" && method !== "DELETE" && !(method === "HEAD" && isBlob)) { return createNotFoundAnswer(); }
  if (!(await checkOwnerSecret(request, env, "share"))) { return createRefusal("unauthorized"); }
  if (method === "PUT") { return write(request, env, target); }
  if (method === "HEAD") { return (await exists(env.KV, target.key)) ? createBytesAnswer(null) : createNotFoundAnswer(); }
  await env.KV.delete(target.key);
  return createNoContentAnswer();
}
