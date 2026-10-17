// Keeps the reader's page-wide shortcuts from firing while the visitor uses the rest of the page.
// TRAP: the reader listens for keys on document; this listener must be added before startReader to run first.
export function fenceReaderKeys(container: HTMLElement): void {
  const guard = (e: KeyboardEvent): void => {
    if (!(e.target instanceof Node) || !container.contains(e.target)) e.stopImmediatePropagation();
  };
  document.addEventListener("keydown", guard);
  document.addEventListener("keyup", guard);
}
