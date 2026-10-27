/**
 * Shares with every library UI component the view store, host channel and configuration, prefs port and root
 * element, with lookups scoped to that root so two mounts on one page never touch each other. It also asks the host for
 * the heavy per-paper data the detail pane shows, once per paper and again when a sidecar or record changed.
 */
import type { LibraryUiCapabilities, LibraryUiLabels } from "../hostConfig.js";
import type { LibraryTransport } from "../protocol/index.js";
import type { ShareHost } from "../../share/index.js";
import type { LibraryViewStore, PrefsPort } from "../store/index.js";

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

interface PaperDetailsRequests {
  /** Asks for a paper's details unless they are here or on the way. */
  ensureDetails(id: string): void;
  /** Asks for a paper's similar papers unless they are here or on the way. */
  ensureSimilar(id: string): void;
  /** Notes that details arrived. */
  received(id: string): void;
  /**
   * Something changed for `id` (null: for any paper). The paper on show is asked for again while it keeps showing what
   * it had; every other paper's details are dropped and fetched when next shown.
   */
  invalidate(id: string | null): void;
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
  sharing?: ShareHost | undefined;
  /** The `.ls-library` element. */
  root: HTMLElement;
  /** Set by the paper list when it mounts. */
  cursor: ListCursor | null;
  /** Requests for the per-paper data the host sends on demand. */
  data: PaperDetailsRequests;
  /** Focuses the search box; `selectText` also selects the query so typing replaces it. */
  focusSearch(selectText?: boolean): void;
  /** Focuses the paper list so the list keys apply. */
  focusList(): void;
}

export interface UiCompositionDeps {
  store: LibraryViewStore;
  transport: LibraryTransport;
  prefs: PrefsPort;
  caps: LibraryUiCapabilities;
  labels: LibraryUiLabels;
  readOnly: boolean;
  sharing?: ShareHost | undefined;
}

export function createUiCompositionRoot(root: HTMLElement, parts: UiCompositionDeps): UiContext {
  return {
    ...parts, root, cursor: null, data: createPaperDetailsRequests(parts),
    focusSearch(selectText = false) {
      const search = root.querySelector<HTMLInputElement>(".ls-library-search");
      search?.focus();
      if (selectText) search?.select();
    },
    focusList() { root.querySelector<HTMLElement>(".paper-list")?.focus(); },
  };
}

/** A dialog, menu or quick input owns the keyboard while it is open. */
export function isOverlayOpen(): boolean {
  return document.querySelector(".ls-scrim") !== null;
}

/** Key hints in the platform's spelling: "⌘C" and "⌥1" on a Mac, "Ctrl+C" and "Alt+1" elsewhere. */
export const KEY_HINT = (() => {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
  return { mod: mac ? "⌘" : "Ctrl+", alt: mac ? "⌥" : "Alt+", remove: mac ? "⌘⌫" : "Delete" };
})();

function createPaperDetailsRequests({ store, transport, caps }: Pick<UiCompositionDeps, "store" | "transport" | "caps">): PaperDetailsRequests {
  const pending = new Set<string>();
  const ask = (id: string): void => {
    pending.add(id);
    transport.post({ type: "paper.details", id });
  };
  return {
    ensureDetails(id) {
      if (!store.get().details[id] && !pending.has(id)) ask(id);
    },
    ensureSimilar(id) {
      if (!caps.similar || store.get().similar[id] !== undefined) return;
      store.setSimilar(id, null);
      transport.post({ type: "paper.similar", id });
    },
    received(id) { pending.delete(id); },
    invalidate(id) {
      const s = store.get();
      const shown = s.selected.size === 1 ? [...s.selected][0]! : null;
      const kept = shown && s.details[shown] ? { [shown]: s.details[shown] } : {};
      const details = id === null ? kept : Object.fromEntries(Object.entries(s.details).filter(([key]) => key !== id || key === shown));
      pending.clear();
      store.set({ details });
      if (shown && (id === null || id === shown)) ask(shown);
    },
  };
}
