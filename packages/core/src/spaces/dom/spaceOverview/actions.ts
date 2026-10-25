// Builds Overview action controls that respect read-only Spaces.
import { renderElement, renderIcon, type IconName } from "../../../ui/dom/index.js";
export function renderOverviewAction(label: string, onClick: () => void, disabled = false, glyph?: IconName): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: "ls-btn ls-btn-ghost", text: label, disabled });
  if (glyph) button.prepend(renderElement("span", { "aria-hidden": "true", html: renderIcon(glyph) }));
  button.addEventListener("click", onClick);
  return button;
}
