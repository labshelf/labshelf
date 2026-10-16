/**
 * Handles "Add Tag…" from the paper menu: shows the detail pane if it is folded away and opens and focuses its tag field.
 */
import { showPane } from "../shell/index.js";
import type { UiContext } from "../uiContext.js";

export function focusTagInput(ctx: UiContext): void {
  showPane(ctx.root, ctx.prefs, "detail");
  // The pane renders the field on Add tag and focuses it; a field already open only needs the focus.
  if (!ctx.root.querySelector(".detail-pane .tag-input")) ctx.root.querySelector<HTMLButtonElement>(".detail-pane .tag-add")?.click();
  const input = ctx.root.querySelector<HTMLInputElement>(".detail-pane .tag-input");
  input?.scrollIntoView({ block: "nearest" });
  input?.focus();
}
