/**
 * Creates the random CSP nonce that authorises one inline script in a webview page.
 */
export function createNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}
