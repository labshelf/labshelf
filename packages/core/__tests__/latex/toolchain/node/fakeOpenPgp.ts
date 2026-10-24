// Builds a test RSA key, its armored OpenPGP public key and detached OpenPGP signatures made with it.
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";

function mpi(value: Buffer): Buffer {
  const start = value.findIndex((byte) => byte !== 0);
  const bytes = value.subarray(start);
  const bits = Buffer.alloc(2);
  bits.writeUInt16BE((bytes.length - 1) * 8 + (32 - Math.clz32(bytes[0] ?? 0)));
  return Buffer.concat([bits, bytes]);
}

function packet(tag: number, body: Buffer): Buffer {
  const length = Buffer.alloc(5);
  length[0] = 0xff;
  length.writeUInt32BE(body.length, 1);
  return Buffer.concat([Buffer.from([0xc0 | tag]), length, body]);
}

function armor(label: string, bytes: Buffer): string {
  const lines = bytes.toString("base64").match(/.{1,64}/g) ?? [];
  return [`-----BEGIN ${label}-----`, "Comment: test", "", ...lines, "=AAAA", `-----END ${label}-----`, ""].join("\n");
}

function publicKeyPacketBody(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: "jwk" });
  const n = Buffer.from(String(jwk.n), "base64url");
  const e = Buffer.from(String(jwk.e), "base64url");
  return Buffer.concat([Buffer.from([4, 0, 0, 0, 0, 1]), mpi(n), mpi(e)]);
}

export interface TestSigningKey {
  privateKey: KeyObject;
  armoredPublicKey: string;
}

export function createTestSigningKey(): TestSigningKey {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { privateKey, armoredPublicKey: armor("PGP PUBLIC KEY BLOCK", packet(6, publicKeyPacketBody(publicKey))) };
}

/** A v4 SHA-512 signature of `type` 0x00 (binary) or 0x01 (canonical text) over `data`. */
export function armoredSignature(data: Buffer, privateKey: KeyObject, type = 0x01): string {
  const hashed = Buffer.from([4, type, 1, 10, 0, 0]);
  const trailer = Buffer.from([4, 0xff, 0, 0, 0, hashed.length]);
  const content = type === 0x01 ? Buffer.from(data.toString("latin1").replace(/\r?\n/g, "\r\n"), "latin1") : data;
  const value = sign("sha512", Buffer.concat([content, hashed, trailer]), privateKey);
  return armor("PGP SIGNATURE", packet(2, Buffer.concat([hashed, Buffer.from([0, 0, 0, 0]), mpi(value)])));
}

/** One key per test run, shared by the fixture that signs and the mock of the pinned key. */
export const TEST_SIGNING_KEY = createTestSigningKey();
