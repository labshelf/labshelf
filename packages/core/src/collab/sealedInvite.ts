// Seals an invite link to one identity so it can cross an untrusted channel, and opens and verifies one sealed to us.
import { base64UrlToBytes, bytesToBase64Url, decodeKeyBytes } from "../encoding/index.js";
import { isRecord } from "../guards/index.js";
import { decodePublicKey, exportPublicKey, fingerprint, importEncryptionKey, publicKeys, signObject, verifyObject } from "./identity.js";
import type { Identity, IdentityKey, JsonObject, JsonValue } from "./identity.js";
import { parseInvite } from "./invite.js";

// Frozen like the share key's labels: changing it makes every invite in flight unreadable.
const LABEL = "labshelf-invite-v1";
const ENVELOPE_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const INVITE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export interface SealedInviteEnvelope {
  v: 1;
  /** The recipient's fingerprint. */
  to: string;
  /** Epoch ms. */
  expires: number;
  epk: string;
  iv: string;
  ct: string;
}

/** The sender's contact card; its other fields are carried as they are. */
export interface SenderCard {
  [key: string]: JsonValue;
  encryptionKey: string;
  signingKey: string;
}

export interface SealedInvitePayload {
  link: string;
  title: string;
  sender: SenderCard;
  created: number;
  expires: number;
}

export interface SealInviteInput {
  sender: Identity;
  card: SenderCard;
  recipient: { encryptionKey: string; fingerprint: string };
  link: string;
  title: string;
  now?: number;
}

export interface OpenInviteOptions {
  now?: number;
  /** Runs the full invite link check; defaults to parsing the link. A refusal or a rejection is `bad_link`. */
  checkLink?: (link: string) => Promise<{ ok: boolean }>;
}

export type SealedInviteErrorReason = "wrong_recipient" | "tampered" | "bad_signature" | "expiry_mismatch" | "expired" | "bad_link";

const MESSAGES: Record<SealedInviteErrorReason, string> = {
  wrong_recipient: "This invitation was sent to someone else.",
  tampered: "This invitation is damaged or was changed on the way.",
  bad_signature: "This invitation's signature does not match its sender.",
  expiry_mismatch: "This invitation's expiry was changed on the way.",
  expired: "This invitation has expired. Ask the sender for a new one.",
  bad_link: "This invitation does not hold a valid invite link.",
};

export class SealedInviteError extends Error {
  constructor(readonly reason: SealedInviteErrorReason) {
    super(MESSAGES[reason]);
    this.name = "SealedInviteError";
  }
}

function additionalData(to: string, expires: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${LABEL}\n${to}\n${expires}`);
}

async function deriveInviteKey(privateKey: IdentityKey, publicKey: IdentityKey, epk: Uint8Array<ArrayBuffer>): Promise<IdentityKey> {
  const secret = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const ikm = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: epk, info: new TextEncoder().encode(LABEL) },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealInvite(input: SealInviteInput): Promise<SealedInviteEnvelope> {
  const created = input.now ?? Date.now();
  const expires = created + INVITE_LIFETIME_MS;
  const payload = { link: input.link, title: input.title, sender: input.card, created, expires };
  const plaintext = { payload, sig: await signObject(input.sender, payload) };
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const epk = await exportPublicKey(ephemeral.publicKey);
  const key = await deriveInviteKey(ephemeral.privateKey, await importEncryptionKey(input.recipient.encryptionKey), base64UrlToBytes(epk) as Uint8Array<ArrayBuffer>);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const to = input.recipient.fingerprint;
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(to, expires) },
    key,
    new TextEncoder().encode(JSON.stringify(plaintext)),
  );
  return { v: ENVELOPE_VERSION, to, expires, epk, iv: bytesToBase64Url(iv), ct: bytesToBase64Url(new Uint8Array(ct)) };
}

function parseEnvelope(input: unknown): SealedInviteEnvelope | undefined {
  let value = input;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return undefined; }
  }
  if (!isRecord(value) || value.v !== ENVELOPE_VERSION) { return undefined; }
  const { to, expires, epk, iv, ct } = value;
  if (typeof to !== "string" || typeof expires !== "number" || !Number.isSafeInteger(expires)) { return undefined; }
  if (typeof epk !== "string" || typeof iv !== "string" || typeof ct !== "string") { return undefined; }
  return { v: ENVELOPE_VERSION, to, expires, epk, iv, ct };
}

function parsePayload(value: unknown): { payload: SealedInvitePayload; sig: string } | undefined {
  if (!isRecord(value) || typeof value.sig !== "string" || !isRecord(value.payload)) { return undefined; }
  const { link, title, sender, created, expires } = value.payload;
  if (typeof link !== "string" || typeof title !== "string" || typeof created !== "number" || typeof expires !== "number") { return undefined; }
  if (!isRecord(sender) || typeof sender.encryptionKey !== "string" || typeof sender.signingKey !== "string") { return undefined; }
  return { payload: value.payload as unknown as SealedInvitePayload, sig: value.sig };
}

async function decrypt(identity: Identity, envelope: SealedInviteEnvelope): Promise<unknown> {
  const epk = decodePublicKey(envelope.epk);
  const iv = decodeKeyBytes(envelope.iv, IV_BYTES);
  const ct = (() => { try { return base64UrlToBytes(envelope.ct); } catch { return undefined; } })();
  if (!epk || !iv || !ct || ct.length < TAG_BYTES) { throw new SealedInviteError("tampered"); }
  try {
    const peer = await crypto.subtle.importKey("raw", epk, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const key = await deriveInviteKey(identity.encryption.privateKey, peer, epk);
    const bytes = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as Uint8Array<ArrayBuffer>, additionalData: additionalData(envelope.to, envelope.expires) },
      key,
      ct as Uint8Array<ArrayBuffer>,
    );
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    // WebCrypto signals an off-curve key or a failed tag only by rejecting; either way the envelope is not authentic.
    throw new SealedInviteError("tampered");
  }
}

async function linkPasses(link: string, checkLink: OpenInviteOptions["checkLink"]): Promise<boolean> {
  try {
    return (await (checkLink ?? parseInvite)(link)).ok;
  } catch {
    return false;
  }
}

/** Gives the payload only when every check passes; otherwise throws a SealedInviteError naming the first that failed. */
export async function openInvite(identity: Identity, envelope: unknown, options: OpenInviteOptions = {}): Promise<SealedInvitePayload> {
  const parsed = parseEnvelope(envelope);
  if (!parsed) { throw new SealedInviteError("tampered"); }
  const own = await publicKeys(identity);
  if (parsed.to !== (await fingerprint(own.encryptionKey, own.signingKey))) { throw new SealedInviteError("wrong_recipient"); }
  const opened = parsePayload(await decrypt(identity, parsed));
  if (!opened) { throw new SealedInviteError("tampered"); }
  const { payload, sig } = opened;
  if (!(await verifyObject(payload.sender.signingKey, { ...(payload as unknown as JsonObject), sig }))) { throw new SealedInviteError("bad_signature"); }
  if (payload.expires !== parsed.expires) { throw new SealedInviteError("expiry_mismatch"); }
  if ((options.now ?? Date.now()) >= parsed.expires) { throw new SealedInviteError("expired"); }
  if (!(await linkPasses(payload.link, options.checkLink))) { throw new SealedInviteError("bad_link"); }
  return payload;
}
