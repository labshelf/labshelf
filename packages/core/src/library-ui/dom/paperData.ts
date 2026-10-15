/**
 * Asks the host for the heavy per-paper data the detail pane shows (annotations, reading position, file, similar
 * papers) once per paper, and again when the host says a paper's sidecar or record changed.
 */
import type { LibraryUiCapabilities } from "../hostConfig.js";
import type { LibraryTransport } from "../protocol/index.js";
import type { LibraryViewStore } from "../state/index.js";

export interface PaperDataRequests {
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

interface Parts {
  store: LibraryViewStore;
  transport: LibraryTransport;
  caps: LibraryUiCapabilities;
}

export function createPaperData({ store, transport, caps }: Parts): PaperDataRequests {
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
