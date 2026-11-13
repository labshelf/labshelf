/**
 * Where the reader keeps its page-wide state. Standalone, the reader owns the document: state classes and theme tokens go on
 * <html>, popovers on <body>, and every key on the page is the reader's. Mounted inside another page, a scope element stands
 * in for both, and keys typed outside it belong to the host page. One reader per document, so the scope is module state.
 */

let scope: HTMLElement | undefined;

/** Sets the element the reader is mounted in and marks it `rd-scope`; undefined returns to owning the document. */
export function setReaderScope(element: HTMLElement | undefined): void {
  scope = element;
  element?.classList.add("rd-scope");
}

/** The scope element, if the reader is mounted inside another page. */
export function readerScope(): HTMLElement | undefined {
  return scope;
}

/** Where state classes, data attributes and theme variables go: the scope, else <html>. */
export function readerRoot(): HTMLElement {
  return scope ?? document.documentElement;
}

/** Where popovers, menus and floating boxes are appended: the scope, else <body>. */
export function readerLayer(): HTMLElement {
  return scope ?? document.body;
}

/**
 * Whether a document-level key event is the reader's. Scoped, only events whose target is inside the scope count; a target of
 * <body> means focus is nowhere in the reader, so it does not count either.
 */
export function isReaderKeyEvent(event: Event): boolean {
  if (!scope) { return true; }
  const target = event.target;
  if (target === document.body || !(target instanceof Node)) { return false; }
  return scope.contains(target);
}
