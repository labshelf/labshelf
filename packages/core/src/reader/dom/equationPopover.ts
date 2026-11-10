// Shows the result of an equation box beside it: progress, then the rendered equation with an editable LaTeX field,
// Copy LaTeX and where the LaTeX came from; the card that offers pix2tex or an API key when nothing could read it; or
// the reason it failed. One popover at a time, answering only the request of the box it was opened for.
import type { EquationOutcome } from "../hostPorts.js";
import { renderElement } from "../../ui/dom/index.js";
import { deriveClampedNumber } from "./elements.js";

export interface EquationPopoverOptions { container: HTMLElement; post: (message: { type: 'installPix2tex' | 'addAiKey'; requestId: string }) => void; renderMath: (target: HTMLElement, latex: string) => Promise<void>; copyText: (text: string) => Promise<void> }

export interface EquationPopover { open(requestId: string, anchor: { left: number; top: number; width: number; height: number }): void; progress(requestId: string, message: string, fraction?: number): void; result(requestId: string, outcome: EquationOutcome): void; close(): void; readonly isOpen: boolean }

type Anchor = { left: number; top: number; width: number; height: number };
type LatexOutcome = Extract<EquationOutcome, { kind: "latex" }>;
type Offers = Extract<EquationOutcome, { kind: "unavailable" }>["offers"];

const PROVIDER_NAMES: Readonly<Record<string, string>> = { anthropic: "Claude", openai: "OpenAI" };
const INSTALL_LABELS: Readonly<Record<Offers["pix2tex"], string | null>> = {
  install: "Download pix2tex (local, free)",
  installHelper: "Install LabShelf Helper",
  none: null,
};
const COPY_LABEL = "Copy LaTeX";
const CONFIRM_MS = 1500;
const GAP = 8;

/** @returns the line that says where the LaTeX came from; a read from an image asks to be checked. */
function formatEquationSource(outcome: LatexOutcome): string {
  if (outcome.source === "arxiv") {
    return ["From the arXiv source", outcome.number ? `Eq. (${outcome.number})` : null, outcome.label || null].filter(Boolean).join(" · ");
  }
  if (outcome.source === "pix2tex") { return "Read by pix2tex — check it"; }
  const provider = outcome.provider ? PROVIDER_NAMES[outcome.provider] ?? outcome.provider : "AI";
  return `Read by ${provider} — check it`;
}

/**
 * @returns the reader's equation popover, placed in `container` by the box anchor (CSS px from the container's on-screen
 * top-left); host replies for any request other than the open one are ignored.
 */
export function createEquationPopover(options: EquationPopoverOptions): EquationPopover {
  const { container, post, renderMath, copyText } = options;
  let root: HTMLElement | null = null;
  let body: HTMLElement | null = null;
  let requestId: string | null = null;
  let anchor: Anchor | null = null;
  // Bumped by every render and every state change; a render attaches only while its number is still the latest.
  let renderSeq = 0;
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !root) { return; }
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  const onPointerDown = (event: Event): void => {
    if (root && !root.contains(event.target as Node)) { close(); }
  };

  function close(): void {
    if (!root) { return; }
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("mousedown", onPointerDown, true);
    clearTimeout(confirmTimer);
    root.remove();
    root = null;
    body = null;
    requestId = null;
    anchor = null;
    renderSeq++;
  }

  function place(): void {
    if (!root || !anchor) { return; }
    const frame = container.getBoundingClientRect();
    const size = root.getBoundingClientRect();
    const boxLeft = frame.left + anchor.left;
    const boxTop = frame.top + anchor.top;
    const below = boxTop + anchor.height + GAP;
    const top = below + size.height > window.innerHeight - GAP && boxTop - size.height - GAP >= GAP ? boxTop - size.height - GAP : below;
    root.style.left = `${deriveClampedNumber(boxLeft, GAP, Math.max(GAP, window.innerWidth - size.width - GAP))}px`;
    root.style.top = `${deriveClampedNumber(top, GAP, Math.max(GAP, window.innerHeight - size.height - GAP))}px`;
  }

  function show(...children: HTMLElement[]): void {
    if (!body) { return; }
    renderSeq++;
    clearTimeout(confirmTimer);
    body.replaceChildren(...children);
    place();
  }

  function renderProgress(message: string, fraction?: number): HTMLElement {
    const bar = fraction === undefined ? null : renderElement("progress", { class: "equation-progress-bar", max: "1", value: String(deriveClampedNumber(fraction, 0, 1)) });
    return renderElement("div", { class: "equation-progress", role: "status", "aria-live": "polite" },
      renderElement("span", { class: "equation-progress-message", text: message }), bar);
  }

  /** Renders `latex` into a fresh element; it replaces the shown render only if no newer render or state came since. */
  function renderInto(slot: HTMLElement, latex: string): void {
    const seq = ++renderSeq;
    const target = renderElement("div", { class: "equation-render-item" });
    if (slot.childElementCount > 0) { target.hidden = true; }
    slot.append(target);
    const settle = (): void => {
      if (seq !== renderSeq) { target.remove(); return; }
      for (const other of [...slot.children]) { if (other !== target) { other.remove(); } }
      target.hidden = false;
      place();
    };
    renderMath(target, latex).then(settle, settle);
  }

  /** @returns the latex view and the call that starts its first render, made after the view is shown. */
  function renderLatex(id: string, outcome: LatexOutcome): { view: HTMLElement[]; start: () => void } {
    const slot = renderElement("div", { class: "equation-render", "aria-live": "polite" });
    const field = renderElement("textarea", { class: "equation-latex", "aria-label": "LaTeX", spellcheck: "false", rows: "3" });
    field.value = outcome.latex;
    field.addEventListener("input", () => { if (requestId === id) { renderInto(slot, field.value); } });
    const copy = renderElement("button", { class: "rd-btn-text rd-btn-primary equation-copy", type: "button", text: COPY_LABEL });
    copy.addEventListener("click", () => {
      const text = field.value;
      const confirm = (label: string): void => {
        if (requestId !== id) { return; }
        copy.textContent = label;
        clearTimeout(confirmTimer);
        confirmTimer = setTimeout(() => { copy.textContent = COPY_LABEL; }, CONFIRM_MS);
      };
      copyText(text).then(() => confirm("Copied"), () => confirm("Could not copy"));
    });
    const source = renderElement("div", { class: "equation-source", text: formatEquationSource(outcome) });
    const actions = renderElement("div", { class: "equation-actions" }, source, copy);
    return { view: [slot, field, actions], start: () => renderInto(slot, field.value) };
  }

  function renderCard(id: string, offers: Offers): HTMLElement {
    const install = INSTALL_LABELS[offers.pix2tex];
    const buttons: HTMLButtonElement[] = [];
    const action = (type: "installPix2tex" | "addAiKey", label: string, className: string): HTMLButtonElement => {
      const button = renderElement("button", { class: `rd-btn-text ${className}`, type: "button", text: label });
      button.addEventListener("click", () => {
        if (requestId !== id) { return; }
        for (const b of buttons) { b.disabled = true; }
        post({ type, requestId: id });
      });
      buttons.push(button);
      return button;
    };
    return renderElement("div", { class: "equation-card" },
      renderElement("p", { class: "equation-card-title", text: "Could not read this equation." }),
      renderElement("p", { class: "equation-card-text", text: "This paper has no arXiv source and no reader for images is set up." }),
      install || offers.aiKey ? renderElement("div", { class: "equation-card-actions" },
        install ? action("installPix2tex", install, "rd-btn-primary equation-install") : null,
        offers.aiKey ? action("addAiKey", "Add an API key (Claude or OpenAI, paid per use)", "equation-add-key") : null) : null);
  }

  function result(id: string, outcome: EquationOutcome): void {
    if (!root || id !== requestId) { return; }
    if (outcome.kind === "latex") {
      const keepFocus = !document.activeElement || document.activeElement === document.body || root.contains(document.activeElement);
      const { view, start } = renderLatex(id, outcome);
      show(...view);
      start();
      if (keepFocus) { root.querySelector<HTMLTextAreaElement>("textarea.equation-latex")?.focus({ preventScroll: true }); }
    } else if (outcome.kind === "unavailable") {
      show(renderCard(id, outcome.offers));
    } else {
      show(renderElement("div", { class: "equation-error", role: "alert", text: outcome.reason }));
    }
  }

  return {
    open(id, at) {
      close();
      requestId = id;
      anchor = { ...at };
      body = renderElement("div", { class: "equation-popover-body" });
      root = renderElement("div", { class: "equation-popover", role: "dialog", "aria-label": "Equation" }, body);
      container.append(root);
      show(renderProgress("Reading the equation…"));
      document.addEventListener("keydown", onKeyDown, true);
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("mousedown", onPointerDown, true);
    },
    progress(id, message, fraction) {
      if (!root || id !== requestId) { return; }
      show(renderProgress(message, fraction));
    },
    result,
    close,
    get isOpen() { return root !== null; },
  };
}
