// Stops pdf.js from scrolling the document when it focuses a page's text layer.

let installed = false;

/**
 * Idempotent; must run before pdf.js renders its first text layer.
 */
export function installTextLayerFocusGuard(): void {
  if (installed) { return; }
  installed = true;
  // PLATFORM: after a link is followed, pdf.js PDFLinkService calls `textLayer.div.focus()` once the destination
  // renders, and focus scrolls. If the reader already pressed Back (peek at a reference and return), that late focus
  // drags them to the destination again, and it can nudge the XYZ position the link asked for. Focus is kept; only
  // its scrolling is removed.
  const nativeFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function focus(this: HTMLElement, options?: FocusOptions): void {
    if (this.classList.contains("textLayer")) {
      nativeFocus.call(this, { ...options, preventScroll: true });
      return;
    }
    nativeFocus.call(this, options);
  };
}
