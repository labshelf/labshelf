/**
 * Creates the random CSP nonce that authorises one inline script in a webview page.
 */
export function createNonce(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
