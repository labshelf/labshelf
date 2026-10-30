// Builds the HTML document a bundle-backed webview page loads: strict CSP, one stylesheet, one module script and the mount point.

export interface HtmlShellOptions {
  /** Fresh per render; the only inline script the CSP allows, also allowed for the stylesheets editors inject. Module files, including lazy chunks, load through `cspSource`. */
  nonce: string;
  /** `webview.cspSource`: scripts, styles, fonts and images load only from the extension. */
  cspSource: string;
  title: string;
  stylesheetUrl: string;
  scriptUrl: string;
  /** Also allow `data:` images, for pages that show thumbnails as data URIs. */
  dataImages?: boolean;
}

export function renderHtmlShell(options: HtmlShellOptions): string {
  const { nonce, cspSource, title, stylesheetUrl, scriptUrl, dataImages = false } = options;
  const images = dataImages ? ` img-src ${cspSource} data:;` : "";
  const csp = `default-src 'none'; script-src 'nonce-${nonce}' ${cspSource}; style-src 'nonce-${nonce}' ${cspSource};${images} font-src ${cspSource};`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${title}</title>
<link rel="stylesheet" href="${stylesheetUrl}"/>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" type="module" src="${scriptUrl}"></script>
</body>
</html>`;
}
