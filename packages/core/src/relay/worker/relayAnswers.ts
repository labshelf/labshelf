// The answers and owner-secret helpers the relay Worker's route files share: CORS headers, refusals, bearer checks and the HMAC of an owner-secret
// purpose. Imports nothing from answerRelayRequest.ts or mirrorRoutes.ts, so both can import from here.

import { base64UrlToBytes, bytesToBase64Url, bytesToHex } from "../../encoding/index.js";
import { encodeRelayBody } from "../relayHttp.js";
import { RELAY_REFUSAL, SHARE_REFUSAL } from "../relayPaths.js";
import type { ShareEnv } from "./cloudflareRuntime.js";

export async function deriveSecretSha256(bytes: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)));
}

/** Compares equal-length digests, so the time taken says nothing about where the texts differ. */
export async function isSecretMatch(given: string, expected: string): Promise<boolean> {
  const encode = (text: string) => new TextEncoder().encode(text);
  const [a, b] = await Promise.all([deriveSecretSha256(encode(given)), deriveSecretSha256(encode(expected))]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) { difference |= a.charCodeAt(index) ^ b.charCodeAt(index); }
  return difference === 0;
}

// CONTRACT: documents/contracts/relay.md#endpoints — any origin, since no cookie is involved.
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export type RefusalKind = keyof typeof RELAY_REFUSAL | keyof typeof SHARE_REFUSAL;

const REFUSAL_STATUS: Record<RefusalKind, number> = {
  malformed: 400, incompatibleVersion: 400, unauthorized: 401, forbidden: 403, claimed: 409,
  notFound: 404, tooLarge: 413, inboxFull: 409, rateLimited: 429, off: 403, otherAccount: 403,
};

const REFUSAL_WIRE: Record<RefusalKind, string> = { ...SHARE_REFUSAL, ...RELAY_REFUSAL };

export function createRefusal(error: RefusalKind): Response {
  return new Response(encodeRelayBody({ error: REFUSAL_WIRE[error] }), {
    status: REFUSAL_STATUS[error], headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export const createPreflightAnswer = (): Response => new Response(null, { status: 204, headers: CORS_HEADERS });

export const createNotFoundAnswer = (): Response => new Response(null, { status: 404, headers: CORS_HEADERS });

/** Raw stored bytes; the share page reads them cross-origin. */
export const createBytesAnswer = (body: ConstructorParameters<typeof Response>[0]): Response =>
  new Response(body, { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/octet-stream" } });

export const bearerOf = (request: Request): string | undefined => /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1];

/** A Worker without `OWNER_SECRET` refuses every owner request and logs why. */
export async function checkOwnerSecret(request: Request, env: ShareEnv, endpoint: string): Promise<boolean> {
  if (!env.OWNER_SECRET) {
    console.error(`relay ${endpoint}: OWNER_SECRET is not set, refusing every owner request`);
    return false;
  }
  const bearer = bearerOf(request);
  return bearer !== undefined && isSecretMatch(bearer, env.OWNER_SECRET);
}

// CONTRACT: documents/contracts/relay.md#auth
/** An HMAC key derived from the owner secret for one purpose (`ticket`, `mirror-session`), so a value signed for one is refused by the other. */
async function ownerMacKey(ownerSecret: string, purpose: string) {
  const secret = await crypto.subtle.importKey("raw", new TextEncoder().encode(ownerSecret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(purpose) },
    secret,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

/** The base64url HMAC of `text` under the owner secret's key for `purpose`. */
export async function signWithOwnerSecret(ownerSecret: string, purpose: string, text: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", await ownerMacKey(ownerSecret, purpose), new TextEncoder().encode(text));
  return bytesToBase64Url(new Uint8Array(mac));
}

/** True when `mac` is the HMAC of `text` for `purpose`; HMAC verify compares in constant time. */
export async function verifyOwnerSecretMac(ownerSecret: string, purpose: string, text: string, mac: string): Promise<boolean> {
  let bytes: Uint8Array;
  try { bytes = base64UrlToBytes(mac); } catch { return false; }
  return crypto.subtle.verify("HMAC", await ownerMacKey(ownerSecret, purpose), bytes as Uint8Array<ArrayBuffer>, new TextEncoder().encode(text));
}
