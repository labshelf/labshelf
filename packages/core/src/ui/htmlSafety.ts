/**
 * Guards HTML and CSP output: escapes a value for HTML text and quoted attributes, and creates the random nonce that authorises one inline script in a webview page.
 */

/** Escapes a value for safe interpolation into HTML text and quoted attributes. */
export function escapeHtml(value: unknown): string {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Creates the random CSP nonce that authorises one inline script in a webview page. */
export function createNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}
