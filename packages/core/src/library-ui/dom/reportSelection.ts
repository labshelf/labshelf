// Tells the host which paper is selected whenever the single selected paper changes.
import type { UiContext } from "./uiContext.js";

/** Posts `paper.selected` with the id of the only selected paper, or null for none or several; returns the stop function. */
export function reportSelection(ctx: UiContext): () => void {
  let first = true;
  return ctx.store.select((s) => (s.selected.size === 1 ? [...s.selected][0]! : null), (id) => {
    if (first) { first = false; return; }
    ctx.transport.post({ type: "paper.selected", id });
  });
}
