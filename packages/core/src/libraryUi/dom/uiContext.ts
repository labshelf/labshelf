/**
 * Shares with every library UI component the view store, host channel and configuration, prefs port and root
 * element, with lookups scoped to that root so two mounts on one page never touch each other.
 */
import type { LibraryUiCapabilities, LibraryUiLabels } from "../hostConfig.js";
import type { LibraryTransport } from "../protocol/index.js";
import type { SharingHost } from "../share/index.js";
import type { LibraryViewStore, PrefsPort } from "../store/index.js";
import { createPaperData, type PaperDataRequests } from "./detailPaneRequests.js";

/** Moves the list cursor; the paper list provides it once mounted. */
export interface ListCursor {
  /** Ids of the rows as shown. */
  order(): readonly string[];
  /** Moves the cursor by `delta` rows (from the edge when there is none), extending the selection when asked. */
  step(delta: 1 | -1, extend: boolean): void;
  /** Moves the cursor by a viewport of rows minus one, extending the selection when asked. */
  page(dir: 1 | -1, extend: boolean): void;
  /** Moves the cursor to the first or last paper of the whole list, rendered or not. */
  edge(to: "first" | "last"): void;
}

export interface UiContext {
  store: LibraryViewStore;
  transport: LibraryTransport;
  prefs: PrefsPort;
  caps: LibraryUiCapabilities;
  labels: LibraryUiLabels;
  /** The library is shown for reading only; components render no editing control. */
  readOnly: boolean;
  /** The host's sharing operations; absent when the host offers no sharing controls. */
  sharing?: SharingHost | undefined;
  /** The `.ls-library` element. */
  root: HTMLElement;
  /** Set by the paper list when it mounts. */
  cursor: ListCursor | null;
  /** Requests for the per-paper data the host sends on demand. */
  data: PaperDataRequests;
  /** Focuses the search box; `selectText` also selects the query so typing replaces it. */
  focusSearch(selectText?: boolean): void;
  /** Focuses the paper list so the list keys apply. */
  focusList(): void;
}

export interface UiContextParts {
  store: LibraryViewStore;
  transport: LibraryTransport;
  prefs: PrefsPort;
  caps: LibraryUiCapabilities;
  labels: LibraryUiLabels;
  readOnly: boolean;
  sharing?: SharingHost | undefined;
}

export function createUiContext(root: HTMLElement, parts: UiContextParts): UiContext {
  return {
    ...parts, root, cursor: null, data: createPaperData(parts),
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

/** Key hints in the platform's spelling: "⌘C" and "⌥1" on a Mac, "Ctrl+C" and "Alt+1" elsewhere. */
export const KEY_HINT = (() => {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
  return { mod: mac ? "⌘" : "Ctrl+", alt: mac ? "⌥" : "Alt+", remove: mac ? "⌘⌫" : "Delete" };
})();
