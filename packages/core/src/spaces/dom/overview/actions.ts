// Builds Overview action controls that respect read-only Spaces.
import { el } from "../../../ui/dom/index.js";
export function overviewAction(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const button = el("button", { type: "button", class: "ls-btn", text: label, disabled });
  button.addEventListener("click", onClick);
  return button;
}
