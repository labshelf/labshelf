/**
 * Escapes a value for safe interpolation into HTML text and quoted attributes.
 */
// The body stays self-contained: the VS Code list webview injects this function's source text into its script.
export function escapeHtml(value: unknown): string {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
