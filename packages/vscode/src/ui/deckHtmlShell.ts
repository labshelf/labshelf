// Builds the HTML document of the deck editor webview: the webview shell with a policy that lets the srcdoc slide frame use inline styles, data and blob images and fonts.
import { renderShellDocument, type HtmlShellOptions } from "./htmlShell.js";

/** The webview shell with the deck policy. style-src carries no nonce, since a nonce makes browsers ignore 'unsafe-inline' and the slide frame inherits this policy; dataImages is ignored. */
export function renderDeckHtmlShell(options: HtmlShellOptions): string {
  const { nonce, cspSource } = options;
  const csp = `default-src 'none'; script-src 'nonce-${nonce}' ${cspSource}; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} data: blob:; font-src ${cspSource} data:; frame-src 'self' about: blob:;`;
  return renderShellDocument(csp, options);
}
