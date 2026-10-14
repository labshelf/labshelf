/**
 * What every library UI component shares: the view store, the host channel, the prefs port and the root element,
 * with lookups scoped to that root so two mounts on one page never touch each other.
 */
import type { LibraryTransport } from "../protocol/index.js";
import type { LibraryViewStore, PrefsPort } from "../state/index.js";

export interface UiContext {
  store: LibraryViewStore;
  transport: LibraryTransport;
  prefs: PrefsPort;
  /** The `.ls-library` element. */
  root: HTMLElement;
  /** Focuses the search box; `selectText` also selects the query so typing replaces it. */
  focusSearch(selectText?: boolean): void;
  /** Focuses the paper list so the list keys apply. */
  focusList(): void;
}

export function createUiContext(root: HTMLElement, store: LibraryViewStore, transport: LibraryTransport, prefs: PrefsPort): UiContext {
  return {
    store, transport, prefs, root,
    focusSearch(selectText = false) {
      const search = root.querySelector<HTMLInputElement>(".ls-library-search");
      search?.focus();
      if (selectText) search?.select();
    },
    focusList() { root.querySelector<HTMLElement>(".paper-list")?.focus(); },
  };
}

/** A dialog, menu or quick input owns the keyboard while it is open. */
export function overlayOpen(): boolean {
  return document.querySelector(".ls-scrim") !== null;
}
