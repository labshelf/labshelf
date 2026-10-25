// Reports a preview PDF that could not reload, at the top of the reader.
import { renderIcon } from "../../../ui/index.js";
import { findElement, renderElement } from "../../../ui/dom/index.js";

export class BuildBanner {
  private readonly root = findElement("build-banner");

  /**
   * Reports a PDF the reader could not reload; the open document stays on screen.
   */
  showReloadError(message: string): void {
    this.render("rd-build-failed", renderElement("span", { class: "rd-build-icon", html: renderIcon("warning") }), `Could not reload the PDF: ${message}`);
  }

  clear(): void {
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  private render(kind: string, glyph: HTMLElement, text: string): void {
    this.root.className = kind;
    this.root.replaceChildren(glyph, renderElement("span", {}, text));
    this.root.hidden = false;
  }
}
