// Edits validated manual glossary drafts in a cancellable modal.
import { el, mountOverlay } from "../../../ui/dom/index.js";
import type { GlossaryTerm } from "../../model/index.js";
import { parseTermDraft } from "../../protocol/index.js";
import type { OverviewContext } from "../overview/index.js";
import { termFields } from "./termFields.js";

export function termDialog(ctx: OverviewContext, term?: GlossaryTerm): () => void {
  const fields = termFields(term);
  const error = el("p", { role: "alert", class: "gl-error" });
  const label = term ? "Edit term" : "Add term";
  const form = el("form", { class: "ls-dialog gl-dialog", role: "dialog", "aria-modal": "true", "aria-label": label, novalidate: true },
    el("h2", { text: label }), fields.body, error);
  const unsubscribe = ctx.end.subscribe(message => { if (message.type === "papers") fields.paintPapers(message.items); });
  const overlay = mountOverlay(form, unsubscribe, ctx.signal ? { signal: ctx.signal } : {});
  const close = (): void => { unsubscribe(); overlay.close(); };
  const cancel = el("button", { class: "ls-btn", type: "button", text: "Cancel" });
  cancel.addEventListener("click", close);
  form.append(el("div", { class: "ls-dialog-actions" }, cancel,
    el("button", { class: "ls-btn ls-btn-primary", type: "submit", text: "Save" })));
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (ctx.readOnly || ctx.signal?.aborted) return;
    const draft = readDraft(fields, error);
    if (!draft) return;
    ctx.end.post(term ? { type: "updateTerm", id: ctx.data.space.id, termId: term.id, term: draft }
      : { type: "addTerm", id: ctx.data.space.id, term: draft });
    close();
  });
  fields.name.focus(); ctx.end.post({ type: "listPapers" });
  return close;
}

function readDraft(fields: ReturnType<typeof termFields>, error: HTMLElement) {
  const name = fields.name.value.trim();
  const definition = fields.definition.value.trim();
  fields.name.setAttribute("aria-invalid", String(!name));
  fields.definition.setAttribute("aria-invalid", String(!definition));
  if (!name || !definition) { error.textContent = "Enter a term and definition."; return undefined; }
  const page = fields.page.value ? Number(fields.page.value) : undefined;
  const draft = parseTermDraft({ term: name, definition,
    ...(fields.symbol.value.trim() ? { symbol: fields.symbol.value.trim() } : {}),
    ...(fields.paper.value ? { source: { paperId: fields.paper.value, ...(page === undefined ? {} : { page }) } } : {}),
  });
  if (!draft) error.textContent = "Enter a whole page number greater than zero.";
  return draft;
}
