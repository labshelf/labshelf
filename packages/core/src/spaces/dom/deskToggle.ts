// Renders the Pin to desk toggle that papers, notes, topics and projects share; a full desk disables pinning.
import { renderElement, renderIcon } from "../../ui/dom/index.js";
import { listDeskItems, SPACE_DESK_LIMIT, type SpaceDeskKind } from "../space.js";
import type { OverviewContext } from "./mountOverview.js";

export function isOnDesk(ctx: OverviewContext, kind: SpaceDeskKind, ref: string): boolean {
  return listDeskItems(ctx.data.space).some(item => item.kind === kind && item.ref === ref);
}

export const isDeskFull = (ctx: OverviewContext): boolean => listDeskItems(ctx.data.space).length >= SPACE_DESK_LIMIT;

export function renderDeskToggle(ctx: OverviewContext, kind: SpaceDeskKind, ref: string): HTMLButtonElement {
  const pinned = isOnDesk(ctx, kind, ref);
  const full = !pinned && isDeskFull(ctx);
  const button = renderElement("button", { type: "button", class: "ls-btn ls-btn-ghost sp-desk-toggle", text: pinned ? "On desk" : "Pin to desk",
    "aria-pressed": String(pinned), disabled: ctx.readOnly || full,
    title: full ? `The desk holds ${SPACE_DESK_LIMIT} items. Unpin one first.` : pinned ? "Unpin from desk" : "Pin to desk" });
  button.prepend(renderElement("span", { "aria-hidden": "true", html: renderIcon("pin") }));
  button.classList.toggle("on", pinned);
  button.addEventListener("click", () => ctx.end.post({ type: pinned ? "unpinFromDesk" : "pinToDesk", id: ctx.data.space.id, kind, ref }));
  return button;
}
