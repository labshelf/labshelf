// Tells the host which papers are selected whenever the selection changes.
import type { UiContext } from "./uiContext.js";

/** Posts `paper.selected` with every selected id, empty for none; returns the stop function. */
export function reportSelection(ctx: UiContext): () => void {
  let first = true;
  return ctx.store.select((s) => [...s.selected], (ids) => {
    if (first) { first = false; return; }
    ctx.transport.post({ type: "paper.selected", ids });
  });
}
