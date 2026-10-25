/**
 * Builds the page a webview shows when its bundle is not in dist/. Text only, with no style or script, so the
 * strictest CSP holds; it tells a dev checkout compiled without the webview build, instead of a blank panel.
 */
import { escapeHtml } from "@labshelf/core";

export function renderBundleMissingHtml(options: { title: string; heading: string; file: string; reopen: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none';"/>
<title>${escapeHtml(options.title)}</title>
</head>
<body>
<h3>${escapeHtml(options.heading)}</h3>
<p>${escapeHtml(options.file)} is missing. Run <code>pnpm --filter @labshelf/vscode build</code> and reopen ${escapeHtml(options.reopen)}.</p>
</body>
</html>`;
}
