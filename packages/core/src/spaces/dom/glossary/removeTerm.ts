// Confirms removal of a glossary term within the surface lifetime.
import { el, icon, mountOverlay } from "../../../ui/dom/index.js";
import type { GlossaryTerm } from "../../model/index.js";
import type { OverviewContext } from "../spaceOverview/index.js";

export function deleteTerm(ctx: OverviewContext, term: GlossaryTerm): () => void {
  const box = el("div", { class: "ls-dialog", role: "alertdialog", "aria-modal": "true", "aria-label": "Delete term" },
    el("div", { class: "ls-dialog-head" }, el("span", { html: icon("warning") }),
      el("div", {}, el("div", { class: "ls-dialog-title", text: "Delete term?" }),
        el("div", { class: "ls-dialog-msg", text: `Delete “${term.term}” from this Space's glossary?` }))));
  const overlay = mountOverlay(box, () => {}, ctx.signal ? { signal: ctx.signal } : {});
  const cancel = el("button", { class: "ls-btn", type: "button", text: "Cancel" });
  const remove = el("button", { class: "ls-btn ls-btn-danger", type: "button", text: "Delete" });
  cancel.addEventListener("click", overlay.close);
  remove.addEventListener("click", () => {
    if (!ctx.readOnly && !ctx.signal?.aborted) ctx.end.post({ type: "removeTerm", id: ctx.data.space.id, termId: term.id });
    overlay.close();
  });
  box.append(el("div", { class: "ls-dialog-actions" }, cancel, remove));
  cancel.focus();
  return overlay.close;
}
