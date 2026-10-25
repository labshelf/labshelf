// Keeps keyboard focus on the same treegrid row while rows are rebuilt or scrolled out of the window and back.
import { findAriaRow } from "./projectRowState.js";

export interface FocusKeeper {
  /** Runs `paint`, then puts focus back on the row with the focused key; `nodeOf` finds a rendered row by key. */
  around(paint: () => void, nodeOf: (key: string) => HTMLElement | undefined): void;
}

export function createRowFocusKeeper(list: HTMLElement): FocusKeeper {
  let focused: string | null = null;
  list.addEventListener("focusin", (e) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>("[data-key]")?.dataset["key"];
    if (key) focused = key;
  });
  return {
    around(paint, nodeOf) {
      const active = document.activeElement;
      const inside = active !== null && list.contains(active);
      paint();
      if (!inside || focused === null) return;
      const node = nodeOf(focused);
      // A row scrolled out of the window parks focus on the list, which does not forward it, so a wheel scroll never jumps back.
      if (!node) { if (document.activeElement !== list) list.focus({ preventScroll: true }); return; }
      const row = findAriaRow(node);
      if (!row.contains(document.activeElement)) row.focus({ preventScroll: true });
    },
  };
}
