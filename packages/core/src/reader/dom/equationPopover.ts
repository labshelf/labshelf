// Shows the result of an equation box beside it: progress, then the rendered equation with an editable LaTeX field
// (the result view below); the card that offers pix2tex or an API key when nothing could read it (the card below, with its
// inline key form); or the reason it failed. One popover at a time, answering only the request of
// the box it was opened for.
import type { AiProvider } from "../../ai/credentials.js";
import type { EquationOutcome } from "../hostPorts.js";
import { renderElement } from "../../ui/dom/index.js";
import { deriveClampedNumber } from "./elements.js";
import { isReaderKeyEvent } from "./scope.js";

/**
 * `saveAiKey`, given by a host whose reader runs in the same page as its key store (the browser), makes the key button open
 * an inline form in the card; the popover hands it the key and posts `addAiKey` once it is stored. Without it the button
 * posts `addAiKey` at once and the host asks for the key itself.
 */
export interface EquationPopoverOptions { container: HTMLElement; post: (message: { type: 'installPix2tex' | 'addAiKey'; requestId: string }) => void; renderMath: (target: HTMLElement, latex: string) => Promise<void>; copyText: (text: string) => Promise<void>; saveAiKey?: (provider: AiProvider, key: string) => Promise<void> }

export interface EquationPopover { open(requestId: string, anchor: { left: number; top: number; width: number; height: number }): void; progress(requestId: string, message: string, fraction?: number): void; result(requestId: string, outcome: EquationOutcome): void; close(): void; readonly isOpen: boolean }

type Anchor = { left: number; top: number; width: number; height: number };

const CONFIRM_MS = 1500;
const GAP = 8;

/**
 * @returns the reader's equation popover, placed in `container` by the box anchor (CSS px from the container's on-screen
 * top-left); host replies for any request other than the open one are ignored.
 */
export function createEquationPopover(options: EquationPopoverOptions): EquationPopover {
  return new ReaderEquationPopover(options);
}

class ReaderEquationPopover implements EquationPopover {
  private root: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private requestId: string | null = null;
  private anchor: Anchor | null = null;
  // Bumped by every render and every state change; a render attaches only while its number is still the latest.
  private renderSeq = 0;
  private confirmTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly options: EquationPopoverOptions;

  constructor(options: EquationPopoverOptions) {
    this.options = options;
  }

  get isOpen(): boolean { return this.root !== null; }

  open(id: string, at: Anchor): void {
    this.close();
    this.requestId = id;
    this.anchor = { ...at };
    this.body = renderElement("div", { class: "equation-popover-body" });
    this.root = renderElement("div", { class: "equation-popover", role: "dialog", "aria-label": "Equation" }, this.body);
    this.options.container.append(this.root);
    this.show(this.renderProgress("Reading the equation…"));
    document.addEventListener("keydown", this.onKeyDown, true);
    document.addEventListener("pointerdown", this.onPointerDown, true);
    document.addEventListener("mousedown", this.onPointerDown, true);
  }

  progress(id: string, message: string, fraction?: number): void {
    if (!this.root || id !== this.requestId) { return; }
    this.show(this.renderProgress(message, fraction));
  }

  result(id: string, outcome: EquationOutcome): void {
    const { root } = this;
    if (!root || id !== this.requestId) { return; }
    if (outcome.kind === "latex") {
      const keepFocus = !document.activeElement || document.activeElement === document.body || root.contains(document.activeElement);
      const { view, start } = renderEquationResult(this.resultHost(id), outcome);
      this.show(...view);
      start();
      if (keepFocus) { root.querySelector<HTMLTextAreaElement>("textarea.equation-latex")?.focus({ preventScroll: true }); }
    } else if (outcome.kind === "unavailable") {
      this.show(renderEquationCard(this.cardHost(id), outcome.offers));
    } else {
      this.show(renderElement("div", { class: "equation-error", role: "alert", text: outcome.reason }));
    }
  }

  close(): void {
    if (!this.root) { return; }
    document.removeEventListener("keydown", this.onKeyDown, true);
    document.removeEventListener("pointerdown", this.onPointerDown, true);
    document.removeEventListener("mousedown", this.onPointerDown, true);
    clearTimeout(this.confirmTimer);
    this.root.remove();
    this.root = null;
    this.body = null;
    this.requestId = null;
    this.anchor = null;
    this.renderSeq++;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.root || !isReaderKeyEvent(event)) { return; }
    event.preventDefault();
    event.stopPropagation();
    this.close();
  };

  private readonly onPointerDown = (event: Event): void => {
    if (this.root && !this.root.contains(event.target as Node)) { this.close(); }
  };

  private place(): void {
    const { root, anchor } = this;
    if (!root || !anchor) { return; }
    const frame = this.options.container.getBoundingClientRect();
    const size = root.getBoundingClientRect();
    const boxLeft = frame.left + anchor.left;
    const boxTop = frame.top + anchor.top;
    const below = boxTop + anchor.height + GAP;
    const top = below + size.height > window.innerHeight - GAP && boxTop - size.height - GAP >= GAP ? boxTop - size.height - GAP : below;
    root.style.left = `${deriveClampedNumber(boxLeft, GAP, Math.max(GAP, window.innerWidth - size.width - GAP))}px`;
    root.style.top = `${deriveClampedNumber(top, GAP, Math.max(GAP, window.innerHeight - size.height - GAP))}px`;
  }

  private show(...children: HTMLElement[]): void {
    if (!this.body) { return; }
    this.renderSeq++;
    clearTimeout(this.confirmTimer);
    this.body.replaceChildren(...children);
    this.place();
  }

  private renderProgress(message: string, fraction?: number): HTMLElement {
    const bar = fraction === undefined ? null : renderElement("progress", { class: "equation-progress-bar", max: "1", value: String(deriveClampedNumber(fraction, 0, 1)) });
    return renderElement("div", { class: "equation-progress", role: "status", "aria-live": "polite" },
      renderElement("span", { class: "equation-progress-message", text: message }), bar);
  }

  /** Renders `latex` into a fresh element; it replaces the shown render only if no newer render or state came since. */
  private renderInto(slot: HTMLElement, latex: string): void {
    const seq = ++this.renderSeq;
    const target = renderElement("div", { class: "equation-render-item" });
    if (slot.childElementCount > 0) { target.hidden = true; }
    slot.append(target);
    const settle = (): void => {
      if (seq !== this.renderSeq) { target.remove(); return; }
      for (const other of [...slot.children]) { if (other !== target) { other.remove(); } }
      target.hidden = false;
      this.place();
    };
    this.options.renderMath(target, latex).then(settle, settle);
  }

  private resultHost(id: string): Parameters<typeof renderEquationResult>[0] {
    return {
      isCurrent: () => this.requestId === id,
      renderInto: (slot, latex) => this.renderInto(slot, latex),
      copyText: this.options.copyText,
      confirmFor: (reset) => {
        clearTimeout(this.confirmTimer);
        this.confirmTimer = setTimeout(reset, CONFIRM_MS);
      },
    };
  }

  private cardHost(id: string): Parameters<typeof renderEquationCard>[0] {
    return {
      isCurrent: () => this.requestId === id,
      post: (type) => this.options.post({ type, requestId: id }),
      place: () => this.place(),
      saveAiKey: this.options.saveAiKey,
    };
  }
}

// ---------- the card when nothing could read the equation ----------
// The card offers pix2tex and an API key.
type EquationOffers = Extract<EquationOutcome, { kind: "unavailable" }>["offers"];

const INSTALL_LABELS: Readonly<Record<EquationOffers["pix2tex"], string | null>> = {
  install: "Download pix2tex (local, free)",
  installHelper: "Install LabShelf Helper",
  none: null,
};

interface EquationCardHost {
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
function renderEquationCard(host: EquationCardHost, offers: EquationOffers): HTMLElement {
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

// ---------- the inline API key form ----------
// Stores the key through the host's `save` and tells the popover when it is stored.
const PROVIDER_NAMES: Readonly<Record<string, string>> = { anthropic: "Claude", openai: "OpenAI" };

interface EquationKeyFormOptions {
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
function renderEquationKeyForm({ save, isCurrent, onSaved, onFailed }: EquationKeyFormOptions): HTMLFormElement {
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

// ---------- the result view ----------
// The editable LaTeX field with its live render, Copy LaTeX and where the LaTeX came from.
type EquationLatexOutcome = Extract<EquationOutcome, { kind: "latex" }>;

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

interface EquationResultHost {
  /** Whether the request the view was made for is still the open one. */
  isCurrent: () => boolean;
  /** Renders `latex` into `slot`; the new render replaces the shown one only if no newer render or state came since. */
  renderInto: (slot: HTMLElement, latex: string) => void;
  copyText: (text: string) => Promise<void>;
  /** Runs `reset` after the confirmation has been shown for a while, replacing any earlier one. */
  confirmFor: (reset: () => void) => void;
}

/** @returns the latex view and the call that starts its first render, made after the view is shown. */
function renderEquationResult(host: EquationResultHost, outcome: EquationLatexOutcome): { view: HTMLElement[]; start: () => void } {
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
