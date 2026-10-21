// Builds an empty-state block with text, an optional hint, icon and action button.
import { el } from "../../dom.js";
import { icon, type IconName } from "../../../icons/index.js";

export interface EmptyStateOptions {
  text: string;
  hint?: string;
  icon?: IconName;
  action?: { label: string; icon?: IconName; primary?: boolean; onClick(): void };
  /** Left-aligned and iconless, for use inside a card. */
  inline?: boolean;
}

export function emptyState(o: EmptyStateOptions): HTMLElement {
  const box = el("div", { class: o.inline ? "ls-empty ls-empty-inline" : "ls-empty" });
  if (o.icon && !o.inline) box.append(el("div", { class: "ls-empty-icon", html: icon(o.icon) }));
  box.append(el("div", { class: "ls-empty-text", text: o.text }));
  if (o.action) {
    const a = o.action;
    const button = el("button", { class: a.primary ? "ls-btn ls-btn-primary" : "ls-btn", type: "button" });
    if (a.icon) button.insertAdjacentHTML("beforeend", icon(a.icon));
    button.append(el("span", { text: a.label }));
    button.addEventListener("click", a.onClick);
    box.append(button);
  }
  if (o.hint) box.append(el("div", { class: "ls-empty-hint", text: o.hint }));
  return box;
}
