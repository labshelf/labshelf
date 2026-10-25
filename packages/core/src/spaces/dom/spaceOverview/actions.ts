// Builds Overview action controls that respect read-only Spaces.
import { el, icon, type IconName } from "../../../ui/dom/index.js";
export function overviewAction(label: string, onClick: () => void, disabled = false, glyph?: IconName): HTMLButtonElement {
  const button = el("button", { type: "button", class: "ls-btn ls-btn-ghost", text: label, disabled });
  if (glyph) button.prepend(el("span", { "aria-hidden": "true", html: icon(glyph) }));
  button.addEventListener("click", onClick);
  return button;
}
