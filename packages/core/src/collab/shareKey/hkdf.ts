// Derives labelled byte strings and AES-GCM keys from a share key with HKDF-SHA-256.

// The share key is uniformly random, so HKDF needs no salt to extract (RFC 5869 §3.1); an empty salt keeps derivation reproducible from the key alone.
const HKDF_SALT = new Uint8Array(0);

// PLATFORM: Node's types declare CryptoKey only under node:crypto, so the type comes from the global crypto every runtime has.
export type DerivedShareKey = Awaited<ReturnType<typeof crypto.subtle.deriveKey>>;

export type DerivationLabel = "share-id" | "content" | "awareness" | "relay";

async function importShareKey(shareKey: Uint8Array): Promise<DerivedShareKey> {
  return crypto.subtle.importKey("raw", shareKey as Uint8Array<ArrayBuffer>, "HKDF", false, ["deriveBits", "deriveKey"]);
}

function hkdfParams(label: DerivationLabel) {
  return { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: new TextEncoder().encode(label) };
}

export async function deriveBytes(shareKey: Uint8Array, label: DerivationLabel, length: number): Promise<Uint8Array> {
  const bits = await crypto.subtle.deriveBits(hkdfParams(label), await importShareKey(shareKey), length * 8);
  return new Uint8Array(bits);
}

export async function deriveAesShareKey(shareKey: Uint8Array, label: "content" | "awareness"): Promise<DerivedShareKey> {
  return crypto.subtle.deriveKey(
    hkdfParams(label),
    await importShareKey(shareKey),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
