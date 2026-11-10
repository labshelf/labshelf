// The inline API key form of the equation card: stores the key through the host's `save` and tells the popover when it is stored.
import type { AiProvider } from "../../ai/credentials.js";
import { renderElement } from "../../ui/dom/index.js";

export const PROVIDER_NAMES: Readonly<Record<string, string>> = { anthropic: "Claude", openai: "OpenAI" };

export interface EquationKeyFormOptions {
  /** Stores the key; the key never leaves it. */
  save: (provider: AiProvider, key: string) => Promise<void>;
  /** Whether the request the form was opened for is still the open one. */
  isCurrent: () => boolean;
  /** Called once the key is stored, while the request is still the open one. */
  onSaved: () => void;
  /** Called after a failed save showed its error, while the request is still the open one, so the popover can move. */
  onFailed: () => void;
}

/** @returns the form that stores the key through `save`, then calls `onSaved` so the host re-runs the request. */
export function renderEquationKeyForm({ save, isCurrent, onSaved, onFailed }: EquationKeyFormOptions): HTMLFormElement {
  const provider = renderElement("select", { class: "equation-key-provider", "aria-label": "Provider" },
    ...(Object.keys(PROVIDER_NAMES) as AiProvider[]).map((value) => renderElement("option", { value, text: PROVIDER_NAMES[value] ?? value })));
  const input = renderElement("input", { class: "equation-key-input", type: "password", "aria-label": "API key", placeholder: "API key", autocomplete: "off", spellcheck: "false" });
  const error = renderElement("p", { class: "equation-key-error", role: "alert" });
  const saveButton = renderElement("button", { class: "rd-btn-text rd-btn-primary equation-key-save", type: "submit", text: "Save key" });
  const form = renderElement("form", { class: "equation-key-form" },
    renderElement("div", { class: "equation-key-row" }, provider, input),
    renderElement("p", { class: "equation-key-note", text: "The key stays in this browser's extension storage. The equation's image is sent to the provider." }),
    error, saveButton);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const key = input.value.trim();
    if (!isCurrent() || key === "" || saveButton.disabled) { return; }
    saveButton.disabled = true;
    error.textContent = "";
    save(provider.value as AiProvider, key).then(
      () => { if (isCurrent()) { onSaved(); } },
      () => {
        if (!isCurrent()) { return; }
        saveButton.disabled = false;
        error.textContent = "The key could not be saved.";
        onFailed();
      });
  });
  return form;
}
