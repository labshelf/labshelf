// Builds focusable controls that explain their missing capability.
import { el, positioned } from "../../../ui/dom/index.js";

export function plannedButton(label: string, reason: string, className = "ls-btn ls-btn-ghost"): HTMLButtonElement {
  const button = el("button", { type: "button", class: className, text: label });
  positioned(button, reason);
  return button;
}

export function plannedSearch(label: string, reason: string): HTMLInputElement {
  const input = el("input", { type: "search", "aria-label": label, placeholder: label, readonly: true });
  positioned(input, reason);
  return input;
}
