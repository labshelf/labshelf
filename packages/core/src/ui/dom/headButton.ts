// Builds a titled icon-only button, used for the sidebar head and the preview footer's stepper.
import { renderIcon, type IconName } from "../icons/index.js";
import { renderElement } from "./dom.js";

/** An icon-only `<button>` of the given class whose title and aria-label are `label`; clicking calls `onClick`. */
export function headButton(className: string, label: string, glyph: IconName, onClick: () => void): HTMLButtonElement {
  const button = renderElement("button", { class: className, type: "button", title: label, "aria-label": label, html: renderIcon(glyph) });
  button.addEventListener("click", onClick);
  return button;
}
