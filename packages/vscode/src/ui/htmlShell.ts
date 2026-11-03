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
  /** Also allow what pdf.js needs to draw PDF pages: its module worker from a blob, fetching it, WebAssembly and data fonts. */
  pdfPages?: boolean;
}

export function renderHtmlShell(options: HtmlShellOptions): string {
  const { nonce, cspSource, dataImages = false, pdfPages = false } = options;
  const images = dataImages || pdfPages ? ` img-src ${cspSource} data: blob:;` : "";
  const pdf = pdfPages ? ` worker-src ${cspSource} blob:; connect-src ${cspSource};` : "";
  const wasm = pdfPages ? " 'wasm-unsafe-eval'" : "";
  const fonts = pdfPages ? `${cspSource} data:` : cspSource;
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'${wasm} ${cspSource}; style-src 'nonce-${nonce}' ${cspSource};${images}${pdf} font-src ${fonts};`;
  return renderShellDocument(csp, options);
}

/** The shell document around a given Content-Security-Policy; the webview shell and the deck shell differ only in their policy. */
export function renderShellDocument(csp: string, options: Pick<HtmlShellOptions, "nonce" | "title" | "stylesheetUrl" | "scriptUrl">): string {
  const { nonce, title, stylesheetUrl, scriptUrl } = options;
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
