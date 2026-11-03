// Builds the HTML document of the deck editor webview: the webview shell with a policy that lets the srcdoc slide frame use inline styles, data and blob images and fonts,
// and lets the PDF panels of LaTeX and Typst talks and posters run pdf.js (its module, a blob: worker, wasm decoders and fetches of the PDF and its data).
import { renderShellDocument, type HtmlShellOptions } from "./htmlShell.js";

/** The webview shell with the deck policy. style-src carries no nonce, since a nonce makes browsers ignore 'unsafe-inline' and the slide frame inherits this policy; images is ignored. */
export function renderDeckHtmlShell(options: HtmlShellOptions): string {
  const { nonce, cspSource } = options;
  const csp = `default-src 'none'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval' ${cspSource}; worker-src ${cspSource} blob:; connect-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} data: blob:; font-src ${cspSource} data:; frame-src 'self' about: blob:;`;
  return renderShellDocument(csp, options);
}
