// A library's identity: an ECDH P-256 pair to be sealed to and an ECDSA P-256 pair to sign with, its fingerprint, and signatures over canonical JSON.
import { bytesToBase64Url, decodeKeyBytes } from "../encoding/index.js";

// PLATFORM: Node's types declare CryptoKey only under node:crypto, so the type comes from the global crypto every runtime has.
export type IdentityKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

export interface IdentityKeyPair {
  privateKey: IdentityKey;
  publicKey: IdentityKey;
}

export interface Identity {
  /** ECDH P-256, for sealed invites. */
  encryption: IdentityKeyPair;
  /** ECDSA P-256, for signatures. */
  signing: IdentityKeyPair;
}

// PLATFORM: JsonWebKey is a DOM type, so the EC members WebCrypto reads and writes are declared here.
interface Jwk {
  kty?: string;
  crv?: string;
  x?: string;
  y?: string;
  d?: string;
  ext?: boolean;
  key_ops?: string[];
  alg?: string;
}

export interface IdentityJwkPair {
  privateKey: Jwk;
  publicKey: Jwk;
}

export interface IdentityJwk {
  encryption: IdentityJwkPair;
  signing: IdentityJwkPair;
}

export interface IdentityPublicKeys {
  encryptionKey: string;
  signingKey: string;
}

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Raw uncompressed P-256 point: 0x04 || x || y. */
export const PUBLIC_KEY_BYTES = 65;
const FINGERPRINT_BYTES = 16;
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDSA_SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

export async function generateIdentity(): Promise<Identity> {
  const encryption = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"]);
  const signing = await crypto.subtle.generateKey(ECDSA, true, ["sign", "verify"]);
  return { encryption, signing };
}

async function exportPair(pair: IdentityKeyPair): Promise<IdentityJwkPair> {
  return { privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey), publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey) };
}

/** The private JWKs are device-local secrets; never write them into a library or project. */
export async function exportIdentity(identity: Identity): Promise<IdentityJwk> {
  return { encryption: await exportPair(identity.encryption), signing: await exportPair(identity.signing) };
}

export async function importIdentity(jwk: IdentityJwk): Promise<Identity> {
  return {
    encryption: {
      privateKey: await crypto.subtle.importKey("jwk", jwk.encryption.privateKey, ECDH, true, ["deriveBits"]),
      publicKey: await crypto.subtle.importKey("jwk", jwk.encryption.publicKey, ECDH, true, []),
    },
    signing: {
      privateKey: await crypto.subtle.importKey("jwk", jwk.signing.privateKey, ECDSA, true, ["sign"]),
      publicKey: await crypto.subtle.importKey("jwk", jwk.signing.publicKey, ECDSA, true, ["verify"]),
    },
  };
}

export async function exportPublicKey(key: IdentityKey): Promise<string> {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
}

export async function publicKeys(identity: Identity): Promise<IdentityPublicKeys> {
  return { encryptionKey: await exportPublicKey(identity.encryption.publicKey), signingKey: await exportPublicKey(identity.signing.publicKey) };
}

/** Gives the raw point bytes only for canonical base64url of 65 bytes starting 0x04; never throws. */
export function decodePublicKey(text: string): Uint8Array<ArrayBuffer> | undefined {
  const bytes = decodeKeyBytes(text, PUBLIC_KEY_BYTES);
  return bytes && bytes[0] === 4 ? (bytes as Uint8Array<ArrayBuffer>) : undefined;
}

/** Throws when `text` is not a valid P-256 public key. */
export async function importEncryptionKey(text: string): Promise<IdentityKey> {
  const raw = decodePublicKey(text);
  if (!raw) { throw new Error("Not a P-256 public key"); }
  return crypto.subtle.importKey("raw", raw, ECDH, true, []);
}

/** Names the identity: the first 16 bytes of SHA-256 over the raw encryption key then the raw signing key. Throws on a malformed key. */
export async function fingerprint(encryptionKey: string, signingKey: string): Promise<string> {
  const encryption = decodePublicKey(encryptionKey);
  const signing = decodePublicKey(signingKey);
  if (!encryption || !signing) { throw new Error("Not a P-256 public key"); }
  const joined = new Uint8Array(PUBLIC_KEY_BYTES * 2);
  joined.set(encryption, 0);
  joined.set(signing, PUBLIC_KEY_BYTES);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", joined));
  return bytesToBase64Url(digest.slice(0, FINGERPRINT_BYTES));
}

/** JSON with keys sorted recursively and no whitespace, so signer and verifier hash the same bytes. */
export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) { return `[${value.map(canonicalJson).join(",")}]`; }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as JsonValue)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function signedBytes(obj: JsonObject): Uint8Array<ArrayBuffer> {
  const { sig: _sig, ...rest } = obj;
  return new TextEncoder().encode(canonicalJson(rest));
}

/** Signs the canonical JSON of `obj` without its `sig` field; gives the P1363 signature as base64url. */
export async function signObject(identity: Identity, obj: JsonObject): Promise<string> {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign(ECDSA_SIGN, identity.signing.privateKey, signedBytes(obj))));
}

/** Checks `obj.sig` against the rest of `obj`; never throws on hostile input. */
export async function verifyObject(signingKey: string, obj: JsonObject): Promise<boolean> {
  const raw = decodePublicKey(signingKey);
  const sig = typeof obj.sig === "string" ? decodeKeyBytes(obj.sig, 64) : undefined;
  if (!raw || !sig) { return false; }
  try {
    const key = await crypto.subtle.importKey("raw", raw, ECDSA, false, ["verify"]);
    return await crypto.subtle.verify(ECDSA_SIGN, key, sig as Uint8Array<ArrayBuffer>, signedBytes(obj));
  } catch {
    // An off-curve point rejects on import; that is a key that verifies nothing.
    return false;
  }
}
