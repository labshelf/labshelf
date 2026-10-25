// Builds an empty-state block with text, an optional hint, icon and action button.
import { renderElement } from "../../dom.js";
import { renderIcon, type IconName } from "../../../icons/index.js";

export interface EmptyNoticeOptions {
  text: string;
  hint?: string;
  icon?: IconName;
  action?: { label: string; icon?: IconName; primary?: boolean; onClick(): void };
  /** Left-aligned and iconless, for use inside a card. */
  inline?: boolean;
}

export function renderEmptyNotice(o: EmptyNoticeOptions): HTMLElement {
  const box = renderElement("div", { class: o.inline ? "ls-empty ls-empty-inline" : "ls-empty" });
  if (o.icon && !o.inline) box.append(renderElement("div", { class: "ls-empty-icon", html: renderIcon(o.icon) }));
  box.append(renderElement("div", { class: "ls-empty-text", text: o.text }));
  if (o.action) {
    const a = o.action;
    const button = renderElement("button", { class: a.primary ? "ls-btn ls-btn-primary" : "ls-btn", type: "button" });
    if (a.icon) button.insertAdjacentHTML("beforeend", renderIcon(a.icon));
    button.append(renderElement("span", { text: a.label }));
    button.addEventListener("click", a.onClick);
    box.append(button);
  }
  if (o.hint) box.append(renderElement("div", { class: "ls-empty-hint", text: o.hint }));
  return box;
}
