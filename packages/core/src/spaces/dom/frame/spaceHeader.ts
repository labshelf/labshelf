// Builds the editable Space name and purpose alongside positioned sharing.
import { el, icon, memberChip, positioned } from "../../../ui/dom/index.js";
import type { OverviewContext } from "../overview/index.js";
function editable(value: string, label: string, className: string, disabled: boolean, save: (text: string) => void): HTMLInputElement {
  const input = el("input", { class: className, value, title: value || label, "aria-label": label, placeholder: label, disabled });
  const commit = (): void => { if (input.value !== value) save(input.value); };
  input.addEventListener("change", commit);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); input.blur(); }
    if (event.key === "Escape") { input.value = value; input.blur(); }
  });
  return input;
}
export function spaceHeader(ctx: OverviewContext): HTMLElement {
  const { id, name, purpose } = ctx.data.space;
  const title = editable(name, "Space name", "sp-name", ctx.readOnly, text => {
    if (text.trim()) ctx.end.post({ type: "renameSpace", id, name: text.trim() });
  });
  const description = editable(purpose ?? "", "Add a purpose", "sp-purpose", ctx.readOnly,
    text => ctx.end.post({ type: "setPurpose", id, ...(text.trim() ? { purpose: text.trim() } : {}) }));
  const share = el("button", { class: "ls-btn ls-button-soft", type: "button" }, el("span", { html: icon("share") }), "Share");
  positioned(share, "Sharing needs a signed-in account");
  return el("header", { class: "sp-head" }, el("div", { class: "sp-title" }, el("h1", {}, title), description),
    el("div", { class: "sp-people" }, memberChip("You")), share);
}
