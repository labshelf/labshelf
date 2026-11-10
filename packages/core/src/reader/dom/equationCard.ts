// The card the equation popover shows when nothing could read the equation: it offers pix2tex and an API key.
import type { AiProvider } from "../../ai/credentials.js";
import type { EquationOutcome } from "../hostPorts.js";
import { renderElement } from "../../ui/dom/index.js";
import { renderEquationKeyForm } from "./equationKeyForm.js";

export type EquationOffers = Extract<EquationOutcome, { kind: "unavailable" }>["offers"];

const INSTALL_LABELS: Readonly<Record<EquationOffers["pix2tex"], string | null>> = {
  install: "Download pix2tex (local, free)",
  installHelper: "Install LabShelf Helper",
  none: null,
};

export interface EquationCardHost {
  /** Whether the request the card was shown for is still the open one. */
  isCurrent: () => boolean;
  /** Posts the action for the request the card was shown for. */
  post: (type: "installPix2tex" | "addAiKey") => void;
  /** Places the popover again after the card grew. */
  place: () => void;
  /** Given by a host that keeps the keys in the reader's page: the key button then opens a form in the card. */
  saveAiKey?: ((provider: AiProvider, key: string) => Promise<void>) | undefined;
}

/** @returns the card for `offers`; its buttons act only while their request is the open one. */
export function renderEquationCard(host: EquationCardHost, offers: EquationOffers): HTMLElement {
  const install = INSTALL_LABELS[offers.pix2tex];
  const buttons: HTMLButtonElement[] = [];
  const card = renderElement("div", { class: "equation-card" },
    renderElement("p", { class: "equation-card-title", text: "Could not read this equation." }),
    renderElement("p", { class: "equation-card-text", text: "This paper has no arXiv source and no reader for images is set up." }));
  const action = (type: "installPix2tex" | "addAiKey", label: string, className: string): HTMLButtonElement => {
    const button = renderElement("button", { class: `rd-btn-text ${className}`, type: "button", text: label });
    button.addEventListener("click", () => {
      if (!host.isCurrent()) { return; }
      for (const b of buttons) { b.disabled = true; }
      if (type === "addAiKey" && host.saveAiKey) { openKeyForm(host, card, host.saveAiKey); return; }
      host.post(type);
    });
    buttons.push(button);
    return button;
  };
  if (install || offers.aiKey) {
    card.append(renderElement("div", { class: "equation-card-actions" },
      install ? action("installPix2tex", install, "rd-btn-primary equation-install") : null,
      offers.aiKey ? action("addAiKey", "Add an API key (Claude or OpenAI, paid per use)", "equation-add-key") : null));
  }
  return card;
}

/** Adds the key form to the card, and posts `addAiKey` once the key is stored so the host re-runs the request. */
function openKeyForm(host: EquationCardHost, card: HTMLElement, save: NonNullable<EquationCardHost["saveAiKey"]>): void {
  const form = renderEquationKeyForm({ save, isCurrent: host.isCurrent, onSaved: () => host.post("addAiKey"), onFailed: host.place });
  card.append(form);
  host.place();
  form.querySelector<HTMLInputElement>("input.equation-key-input")?.focus({ preventScroll: true });
}
