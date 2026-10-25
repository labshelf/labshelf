// Builds focusable controls that explain their missing capability.
import { renderElement, setPlannedNotice } from "../../../ui/dom/index.js";

export function renderPlannedButton(label: string, reason: string, className = "ls-btn ls-btn-ghost"): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: className, text: label });
  setPlannedNotice(button, reason);
  return button;
}

export function renderPlannedSearch(label: string, reason: string): HTMLInputElement {
  const input = renderElement("input", { type: "search", "aria-label": label, placeholder: label, readonly: true });
  setPlannedNotice(input, reason);
  return input;
}
