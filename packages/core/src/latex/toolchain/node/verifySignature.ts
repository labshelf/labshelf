// Verifies a detached OpenPGP v4 RSA signature against a pinned public key block.
// The pinned key is the trust anchor: key expiry and revocation are not checked.
import { createHash, createPublicKey, constants, verify, type KeyObject } from "node:crypto";

export interface OpenPgpPacket {
  tag: number;
  body: Buffer;
}

/** The binary content of the first `-----BEGIN <label>-----` block; the CRC line is ignored. */
function dearmor(armored: string, label: string): Buffer {
  const lines = armored.split(/\r?\n/).map((line) => line.trim());
  const begin = lines.indexOf(`-----BEGIN ${label}-----`);
  const end = lines.indexOf(`-----END ${label}-----`, begin + 1);
  if (begin < 0 || end < 0) { throw new Error(`Expected an armored ${label} block`); }
  const blank = lines.indexOf("", begin + 1);
  if (blank < 0 || blank > end) { throw new Error(`The armored ${label} block has no blank line after its headers`); }
  const body = lines.slice(blank + 1, end).filter((line) => !line.startsWith("=")).join("");
  return Buffer.from(body, "base64");
}

function readLength(bytes: Buffer, offset: number, newFormat: boolean, lengthType: number): { length: number; start: number } {
  if (newFormat) {
    const first = bytes[offset] ?? 0;
    if (first < 192) { return { length: first, start: offset + 1 }; }
    if (first < 224) { return { length: ((first - 192) << 8) + (bytes[offset + 1] ?? 0) + 192, start: offset + 2 }; }
    if (first === 255 && offset + 5 <= bytes.length) { return { length: bytes.readUInt32BE(offset + 1), start: offset + 5 }; }
    throw new Error("OpenPGP partial body lengths are not supported");
  }
  if (lengthType === 0) { return { length: bytes[offset] ?? 0, start: offset + 1 }; }
  if (lengthType === 1 && offset + 2 <= bytes.length) { return { length: bytes.readUInt16BE(offset), start: offset + 2 }; }
  if (lengthType === 2 && offset + 4 <= bytes.length) { return { length: bytes.readUInt32BE(offset), start: offset + 4 }; }
  throw new Error("OpenPGP indeterminate packet lengths are not supported");
}

function readPackets(bytes: Buffer): OpenPgpPacket[] {
  const packets: OpenPgpPacket[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const header = bytes[offset] ?? 0;
    if ((header & 0x80) === 0) { throw new Error(`Invalid OpenPGP packet header at byte ${offset}`); }
    const newFormat = (header & 0x40) !== 0;
    const tag = newFormat ? header & 0x3f : (header >> 2) & 0x0f;
    const { length, start } = readLength(bytes, offset + 1, newFormat, header & 0x03);
    if (start + length > bytes.length) { throw new Error(`Truncated OpenPGP packet (tag ${tag}) at byte ${offset}`); }
    packets.push({ tag, body: bytes.subarray(start, start + length) });
    offset = start + length;
  }
  return packets;
}

/** Reads a multiprecision integer at `offset`; returns its magnitude bytes and the offset after it. */
function readMpi(body: Buffer, offset: number): { value: Buffer; next: number } {
  if (offset + 2 > body.length) { throw new Error("Truncated OpenPGP MPI"); }
  const next = offset + 2 + Math.ceil(body.readUInt16BE(offset) / 8);
  if (next > body.length) { throw new Error("Truncated OpenPGP MPI"); }
  return { value: body.subarray(offset + 2, next), next };
}

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
