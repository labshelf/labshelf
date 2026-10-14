/**
 * Creates the random CSP nonce that authorises one inline script in a webview page.
 */

// Every host has Web Crypto, but the neutral compile target carries no DOM or Node types.
interface RandomSource {
  getRandomValues(array: Uint8Array): Uint8Array;
}

export function createNonce(): string {
  const { crypto } = globalThis as unknown as { crypto: RandomSource };
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
