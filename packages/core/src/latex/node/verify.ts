// Fetches and trusts downloaded files: a SHA-256 checked download, a pinned OpenPGP signature check, the pinned TeX Live key and archive unpacking.
import { execFile } from "node:child_process";
import { createHash, createPublicKey, constants, verify, type KeyObject } from "node:crypto";
import { join } from "node:path";
import { promisify } from "node:util";

import type { FetchLike } from "../../ports/index.js";

/** The downloaded bytes; throws when the request fails, is aborted or the hash differs from `sha256`. */
export async function downloadVerified(
  url: string,
  sha256: string,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<Buffer> {
  const response = await fetchImpl(url, signal ? { signal } : {});
  if (!response.ok) { throw new Error(`Download failed with HTTP ${response.status} from ${url}`); }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== sha256) {
    throw new Error(`Checksum mismatch for ${url}: expected ${sha256}, got ${actual}`);
  }
  return bytes;
}

const run = promisify(execFile);

function tarProgram(): string {
  // PLATFORM: on Windows a GNU tar earlier on PATH (Git for Windows) cannot read .zip; the system bsdtar can.
  const systemRoot = process.env["SystemRoot"];
  return process.platform === "win32" && systemRoot ? join(systemRoot, "System32", "tar.exe") : "tar";
}

export async function extractArchive(
  archive: string,
  kind: "tar.gz" | "zip",
  destination: string,
  signal?: AbortSignal,
): Promise<void> {
  await run(tarProgram(), [kind === "tar.gz" ? "-xzf" : "-xf", archive, "-C", destination], signal ? { signal } : {});
}

// Verifies a detached OpenPGP v4 RSA signature against a pinned public key block.
// The pinned key is the trust anchor: key expiry and revocation are not checked.

interface OpenPgpPacket {
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

export function derivePinnedFingerprints(armoredKeys: string): string[] {
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

// Pins the TeX Live Distribution OpenPGP key (primary C78B82D8C79512F79CC0D7C80D5E5D9106BAB6BC) that signs CTAN checksums.
// Holds the primary key and its signing subkey D8F2F86057A857E42A88106A4CE1877E19438C70 only.
export const TEX_LIVE_SIGNING_KEY = `-----BEGIN PGP PUBLIC KEY BLOCK-----

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
+h323/4=
=iADv
-----END PGP PUBLIC KEY BLOCK-----
`;
