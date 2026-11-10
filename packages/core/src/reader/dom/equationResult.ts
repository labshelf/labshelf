// The equation popover's result view: the editable LaTeX field with its live render, Copy LaTeX and where the LaTeX came from.
import type { EquationOutcome } from "../hostPorts.js";
import { renderElement } from "../../ui/dom/index.js";
import { PROVIDER_NAMES } from "./equationKeyForm.js";

export type EquationLatexOutcome = Extract<EquationOutcome, { kind: "latex" }>;

const COPY_LABEL = "Copy LaTeX";

/** @returns the line that says where the LaTeX came from; a read from an image asks to be checked. */
function formatEquationSource(outcome: EquationLatexOutcome): string {
  if (outcome.source === "arxiv") {
    return ["From the arXiv source", outcome.number ? `Eq. (${outcome.number})` : null, outcome.label || null].filter(Boolean).join(" · ");
  }
  if (outcome.source === "pix2tex") { return "Read by pix2tex — check it"; }
  const provider = outcome.provider ? PROVIDER_NAMES[outcome.provider] ?? outcome.provider : "AI";
  return `Read by ${provider} — check it`;
}

export interface EquationResultHost {
  /** Whether the request the view was made for is still the open one. */
  isCurrent: () => boolean;
  /** Renders `latex` into `slot`; the new render replaces the shown one only if no newer render or state came since. */
  renderInto: (slot: HTMLElement, latex: string) => void;
  copyText: (text: string) => Promise<void>;
  /** Runs `reset` after the confirmation has been shown for a while, replacing any earlier one. */
  confirmFor: (reset: () => void) => void;
}

/** @returns the latex view and the call that starts its first render, made after the view is shown. */
export function renderEquationResult(host: EquationResultHost, outcome: EquationLatexOutcome): { view: HTMLElement[]; start: () => void } {
  const slot = renderElement("div", { class: "equation-render", "aria-live": "polite" });
  const field = renderElement("textarea", { class: "equation-latex", "aria-label": "LaTeX", spellcheck: "false", rows: "3" });
  field.value = outcome.latex;
  field.addEventListener("input", () => { if (host.isCurrent()) { host.renderInto(slot, field.value); } });
  const copy = renderElement("button", { class: "rd-btn-text rd-btn-primary equation-copy", type: "button", text: COPY_LABEL });
  copy.addEventListener("click", () => {
    const confirm = (label: string): void => {
      if (!host.isCurrent()) { return; }
      copy.textContent = label;
      host.confirmFor(() => { copy.textContent = COPY_LABEL; });
    };
    host.copyText(field.value).then(() => confirm("Copied"), () => confirm("Could not copy"));
  });
  const source = renderElement("div", { class: "equation-source", text: formatEquationSource(outcome) });
  const actions = renderElement("div", { class: "equation-actions" }, source, copy);
  return { view: [slot, field, actions], start: () => host.renderInto(slot, field.value) };
}
