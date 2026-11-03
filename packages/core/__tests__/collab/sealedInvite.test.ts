import { bytesToBase64Url, base64UrlToBytes } from "../../src/encoding/index.js";
import {
  INVITE_LIFETIME_MS, SealedInviteError, canonicalJson, createShareKey, exportIdentity, fingerprint, formatInvite, generateIdentity,
  importIdentity, openInvite, publicKeys, sealInvite, signObject, verifyObject,
} from "../../src/collab/index.js";
import type { SealedInviteEnvelope, SealedInviteErrorReason } from "../../src/collab/index.js";

const NOW = 1_700_000_000_000;

async function setup() {
  const sender = await generateIdentity();
  const recipient = await generateIdentity();
  const senderKeys = await publicKeys(sender);
  const recipientKeys = await publicKeys(recipient);
  const card = { name: "Ada", inboxUrl: "https://inbox.example", inboxToken: "t", ...senderKeys, updated: NOW };
  const link = await formatInvite({ shareKey: createShareKey(), relays: [{ url: "https://relay.example" }] });
  const to = await fingerprint(recipientKeys.encryptionKey, recipientKeys.signingKey);
  const seal = (overrides: { link?: string; now?: number } = {}) => sealInvite({
    sender, card, recipient: { encryptionKey: recipientKeys.encryptionKey, fingerprint: to }, link: overrides.link ?? link, title: "Paper", now: overrides.now ?? NOW,
  });
  return { sender, recipient, card, link, to, seal };
}

async function reasonOf(promise: Promise<unknown>): Promise<SealedInviteErrorReason | "none"> {
  try {
    await promise;
    return "none";
  } catch (error) {
    expect(error).toBeInstanceOf(SealedInviteError);
    return (error as SealedInviteError).reason;
  }
}

function flipByte(text: string): string {
  const bytes = base64UrlToBytes(text);
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  return bytesToBase64Url(bytes);
}

describe("identity", () => {
  it("writes public keys as raw uncompressed points and fingerprints them to 16 bytes", async () => {
    const keys = await publicKeys(await generateIdentity());
    for (const key of [keys.encryptionKey, keys.signingKey]) {
      const raw = base64UrlToBytes(key);
      expect(raw.length).toBe(65);
      expect(raw[0]).toBe(4);
    }
    const id = await fingerprint(keys.encryptionKey, keys.signingKey);
    expect(base64UrlToBytes(id).length).toBe(16);
    const concat = new Uint8Array([...base64UrlToBytes(keys.encryptionKey), ...base64UrlToBytes(keys.signingKey)]);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", concat));
    expect(id).toBe(bytesToBase64Url(digest.slice(0, 16)));
  });

  it("exports and imports as JWK and keeps its fingerprint and its signing ability (4.2b)", async () => {
    const identity = await generateIdentity();
    const keys = await publicKeys(identity);
    const jwk = JSON.parse(JSON.stringify(await exportIdentity(identity)));
    expect(jwk.encryption.privateKey.d).toEqual(expect.any(String));
    expect(jwk.signing.publicKey.kty).toBe("EC");
    const restored = await importIdentity(jwk);
    const restoredKeys = await publicKeys(restored);
    expect(restoredKeys).toEqual(keys);
    expect(await fingerprint(restoredKeys.encryptionKey, restoredKeys.signingKey)).toBe(await fingerprint(keys.encryptionKey, keys.signingKey));
    const obj = { a: 1, b: "x" };
    expect(await verifyObject(keys.signingKey, { ...obj, sig: await signObject(restored, obj) })).toBe(true);
  });

  it("sorts keys recursively without whitespace in canonical JSON", () => {
    expect(canonicalJson({ b: [{ d: 1, c: 2 }], a: { z: null, y: true } })).toBe('{"a":{"y":true,"z":null},"b":[{"c":2,"d":1}]}');
  });

  it("signs an object without its sig field and refuses a changed one", async () => {
    const identity = await generateIdentity();
    const { signingKey } = await publicKeys(identity);
    const sig = await signObject(identity, { x: 1, sig: "old" });
    expect(base64UrlToBytes(sig).length).toBe(64);
    expect(await verifyObject(signingKey, { sig, x: 1 })).toBe(true);
    expect(await verifyObject(signingKey, { sig, x: 2 })).toBe(false);
    expect(await verifyObject(signingKey, { x: 1 })).toBe(false);
    expect(await verifyObject("garbage", { sig, x: 1 })).toBe(false);
  });
});

describe("sealed invite (4.2a)", () => {
  it("round-trips and has the frozen envelope shape", async () => {
    const { recipient, card, link, to, seal } = await setup();
    const envelope = await seal();
    expect(Object.keys(envelope).sort()).toEqual(["ct", "epk", "expires", "iv", "to", "v"]);
    expect(envelope).toMatchObject({ v: 1, to, expires: NOW + INVITE_LIFETIME_MS });
    expect(INVITE_LIFETIME_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(base64UrlToBytes(envelope.iv).length).toBe(12);
    expect(base64UrlToBytes(envelope.epk).length).toBe(65);
    const payload = await openInvite(recipient, JSON.parse(JSON.stringify(envelope)), { now: NOW + 1 });
    expect(payload).toEqual({ link, title: "Paper", sender: card, created: NOW, expires: NOW + INVITE_LIFETIME_MS });
    expect(await openInvite(recipient, JSON.stringify(envelope), { now: NOW })).toEqual(payload);
  });

  it("refuses another recipient", async () => {
    const { seal } = await setup();
    expect(await reasonOf(openInvite(await generateIdentity(), await seal(), { now: NOW }))).toBe("wrong_recipient");
  });

  it("refuses a changed byte as tampered", async () => {
    const { recipient, seal } = await setup();
    const envelope = await seal();
    for (const field of ["ct", "iv", "epk"] as const) {
      const changed: SealedInviteEnvelope = { ...envelope, [field]: flipByte(envelope[field]) };
      expect(await reasonOf(openInvite(recipient, changed, { now: NOW }))).toBe("tampered");
    }
    // The expiry is bound into the additional data.
    expect(await reasonOf(openInvite(recipient, { ...envelope, expires: envelope.expires + 1 }, { now: NOW }))).toBe("tampered");
    expect(await reasonOf(openInvite(recipient, "{not json", { now: NOW }))).toBe("tampered");
    expect(await reasonOf(openInvite(recipient, { v: 1 }, { now: NOW }))).toBe("tampered");
  });

  it("refuses a bad signature", async () => {
    const { recipient, to, card, link } = await setup();
    const impostor = await generateIdentity();
    // Card claims the sender's keys but the payload is signed by someone else.
    const recipientKeys = await publicKeys(recipient);
    const envelope = await sealInvite({
      sender: impostor, card, recipient: { encryptionKey: recipientKeys.encryptionKey, fingerprint: to }, link, title: "Paper", now: NOW,
    });
    expect(await reasonOf(openInvite(recipient, envelope, { now: NOW }))).toBe("bad_signature");
  });

  it("refuses an expired invite at and after expires", async () => {
    const { recipient, seal } = await setup();
    const envelope = await seal();
    expect(await reasonOf(openInvite(recipient, envelope, { now: envelope.expires }))).toBe("expired");
    expect(await reasonOf(openInvite(recipient, envelope, { now: envelope.expires + 1 }))).toBe("expired");
    expect(await reasonOf(openInvite(recipient, envelope, { now: envelope.expires - 1 }))).toBe("none");
  });

  it("refuses a link the invite check refuses", async () => {
    const { recipient, seal } = await setup();
    expect(await reasonOf(openInvite(recipient, await seal({ link: "not a link" }), { now: NOW }))).toBe("bad_link");
    const envelope = await seal();
    expect(await reasonOf(openInvite(recipient, envelope, { now: NOW, checkLink: async () => ({ ok: false }) }))).toBe("bad_link");
    expect(await reasonOf(openInvite(recipient, envelope, { now: NOW, checkLink: () => Promise.reject(new Error("x")) }))).toBe("bad_link");
  });
});
