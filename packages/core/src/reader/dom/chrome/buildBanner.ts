// Reports a preview PDF that could not reload, at the top of the reader.
import { icon } from "../../../ui/index.js";
import { $, el } from "../../../ui/dom/index.js";

export class BuildBanner {
  private readonly root = $("build-banner");

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
