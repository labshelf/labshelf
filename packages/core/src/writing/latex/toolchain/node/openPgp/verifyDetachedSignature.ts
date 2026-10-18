// Verifies a detached OpenPGP v4 RSA signature against a pinned public key block.
// The pinned key is the trust anchor: key expiry and revocation are not checked.
import { createHash, createPublicKey, constants, verify, type KeyObject } from "node:crypto";

import { dearmor, readMpi, readPackets } from "./openPgpPackets.js";

const PUBLIC_KEY_TAGS = new Set([6, 14]);
const SIGNATURE_TAG = 2;
const RSA = 1;
const HASHES: Record<number, string> = { 8: "sha256", 9: "sha384", 10: "sha512", 11: "sha224" };

interface PinnedKey {
  fingerprint: string;
  key: KeyObject;
  modulusLength: number;
}

function pinnedKeys(armoredKeys: string): PinnedKey[] {
  return readPackets(dearmor(armoredKeys, "PGP PUBLIC KEY BLOCK")).flatMap(({ tag, body }) => {
    if (!PUBLIC_KEY_TAGS.has(tag) || body[0] !== 4 || body[5] !== RSA) { return []; }
    const n = readMpi(body, 6);
    const e = readMpi(body, n.next);
    const length = Buffer.alloc(3);
    length[0] = 0x99;
    length.writeUInt16BE(body.length, 1);
    const fingerprint = createHash("sha1").update(length).update(body).digest("hex").toUpperCase();
    const key = createPublicKey({ key: { kty: "RSA", n: n.value.toString("base64url"), e: e.value.toString("base64url") }, format: "jwk" });
    return [{ fingerprint, key, modulusLength: n.value.length }];
  });
}

export function pinnedKeyFingerprints(armoredKeys: string): string[] {
  return pinnedKeys(armoredKeys).map((key) => key.fingerprint);
}

interface ParsedSignature {
  hashName: string;
  signedBytes: Buffer;
  value: Buffer;
}

function parseSignature(data: Buffer, armoredSignature: string): ParsedSignature {
  const packet = readPackets(dearmor(armoredSignature, "PGP SIGNATURE")).find(({ tag }) => tag === SIGNATURE_TAG);
  if (!packet) { throw new Error("The armored PGP SIGNATURE holds no signature packet"); }
  const { body } = packet;
  if (body.length < 6) { throw new Error("Truncated OpenPGP signature packet"); }
  const [version, type, publicKeyAlgorithm, hashAlgorithm] = body;
  const hashName = HASHES[hashAlgorithm ?? 0];
  if (version !== 4 || (type !== 0x00 && type !== 0x01) || publicKeyAlgorithm !== RSA || !hashName) {
    throw new Error(`Unsupported OpenPGP signature: version ${version}, type ${type}, key algorithm ${publicKeyAlgorithm}, hash ${hashAlgorithm}`);
  }
  const hashedEnd = 6 + body.readUInt16BE(4);
  if (hashedEnd + 2 > body.length) { throw new Error("Truncated OpenPGP signature packet"); }
  // The 2 bytes after the unhashed subpackets are the left 16 bits of the hash, not needed to verify.
  const valueOffset = hashedEnd + 2 + body.readUInt16BE(hashedEnd) + 2;
  const { value } = readMpi(body, valueOffset);
  const content = type === 0x01 ? Buffer.from(data.toString("latin1").replace(/\r?\n/g, "\r\n"), "latin1") : data;
  const trailer = Buffer.alloc(6);
  trailer[0] = 0x04;
  trailer[1] = 0xff;
  trailer.writeUInt32BE(hashedEnd, 2);
  return { hashName, signedBytes: Buffer.concat([content, body.subarray(0, hashedEnd), trailer]), value };
}

/** The fingerprint (uppercase hex) of the pinned key or subkey that signed `data`, or undefined when none did. */
export function verifyDetachedSignature(data: Buffer, armoredSignature: string, armoredKeys: string): string | undefined {
  const { hashName, signedBytes, value } = parseSignature(data, armoredSignature);
  return pinnedKeys(armoredKeys).find(({ key, modulusLength }) => {
    if (value.length > modulusLength) { return false; }
    const padded = Buffer.concat([Buffer.alloc(modulusLength - value.length), value]);
    return verify(hashName, signedBytes, { key, padding: constants.RSA_PKCS1_PADDING }, padded);
  })?.fingerprint;
}
