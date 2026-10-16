/**
 * Shows a preview's build state at the top of the reader: a quiet note while a build runs, a failure as a button, and
 * a PDF that could not reload.
 */
import { icon } from "../../../ui/index.js";
import { $, el } from "../../../ui/dom/index.js";

export class BuildBanner {
  private readonly root = $("build-banner");

  /** Shows a quiet note that a build runs. */
  showBusy(): void {
    this.render("rd-build-busy", el("span", { class: "rd-build-icon rd-spin", html: icon("loader") }), "Building…");
  }

  /** Shows a failure as a button; `note` is quiet text beside it. */
  showFailed({ label, title, note, onClick }: { label: string; title: string; note?: string; onClick: () => void }): void {
    const button = el("button", { class: "rd-build-action", type: "button", title },
      el("span", { class: "rd-build-icon", html: icon("warning") }), label);
    button.addEventListener("click", onClick);
    this.root.className = "rd-build-failed";
    this.root.replaceChildren(button, ...(note ? [el("span", { class: "rd-build-note" }, note)] : []));
    this.root.hidden = false;
  }

  /**
   * Reports a PDF the reader could not reload; the open document stays on screen.
   */
  showReloadError(message: string): void {
    this.render("rd-build-failed", el("span", { class: "rd-build-icon", html: icon("warning") }), `Could not reload the PDF: ${message}`);
  }

  clear(): void {
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  private render(kind: string, glyph: HTMLElement, text: string): void {
    this.root.className = kind;
    this.root.replaceChildren(glyph, el("span", {}, text));
    this.root.hidden = false;
  }
}
