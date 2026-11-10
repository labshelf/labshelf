// Shows the result of an equation box beside it: progress, then the rendered equation with an editable LaTeX field
// (`equationResult.ts`); the card that offers pix2tex or an API key when nothing could read it (`equationCard.ts`, with the
// inline key form of `equationKeyForm.ts`); or the reason it failed. One popover at a time, answering only the request of
// the box it was opened for.
import type { AiProvider } from "../../ai/credentials.js";
import type { EquationOutcome } from "../hostPorts.js";
import { renderElement } from "../../ui/dom/index.js";
import { renderEquationCard } from "./equationCard.js";
import { renderEquationResult } from "./equationResult.js";
import { deriveClampedNumber } from "./elements.js";

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
    if (event.key !== "Escape" || !this.root) { return; }
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
