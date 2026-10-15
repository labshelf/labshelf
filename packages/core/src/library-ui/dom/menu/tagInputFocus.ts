/**
 * Handles "Add Tag…" from the paper menu: shows the detail pane if it is folded away and focuses its tag field.
 */
import { showPane } from "../shell/index.js";
import type { UiContext } from "../uiContext.js";

export function focusTagInput(ctx: UiContext): void {
  showPane(ctx.root, ctx.prefs, "detail");
  const input = ctx.root.querySelector<HTMLInputElement>(".detail-pane .tag-input");
  input?.scrollIntoView({ block: "nearest" });
  input?.focus();
}
