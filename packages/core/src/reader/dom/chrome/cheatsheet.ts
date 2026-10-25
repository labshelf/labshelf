/**
 * Shows the `?` overlay listing every active shortcut, generated from the keymap so it can never drift from the real bindings.
 */
import { deriveCheatsheetRows } from "../../navigation/index.js";
import type { ReaderContext } from "../session/index.js";
import { findElement, renderElement } from "../../../ui/dom/index.js";

export class Cheatsheet {
  private readonly el = findElement("cheatsheet");

  constructor(private readonly ctx: ReaderContext) {
    this.el.addEventListener("mousedown", (e) => { if (e.target === this.el) { this.close(); } });
  }

  get isOpen(): boolean { return this.el.classList.contains("rd-open"); }

  /**
   * Opens the overlay if closed, closes it if open.
   */
  toggle(): void {
    if (this.isOpen) { this.close(); } else { this.open(); }
  }

  /**
   * Closes the overlay and clears its content.
   */
  close(): void {
    this.el.classList.remove("rd-open");
    this.el.replaceChildren();
  }

  private open(): void {
    const rows = deriveCheatsheetRows({ vimKeys: this.ctx.prefs.vimKeys, isMac: this.ctx.boot.isMac, preview: this.ctx.boot.preview });
    const card = renderElement("div", { class: "rd-cheat-card", role: "dialog", "aria-label": "Keyboard shortcuts" });
    card.append(renderElement("div", { class: "rd-cheat-title" }, "Keyboard shortcuts"));
    const grid = renderElement("div", { class: "rd-cheat-grid" });
    let group = "";
    let column: HTMLElement | null = null;
    for (const row of rows) {
      if (row.group !== group || !column) {
        group = row.group;
        column = renderElement("div", { class: "rd-cheat-col" }, renderElement("div", { class: "rd-cheat-group" }, group));
        grid.append(column);
      }
      const keys = renderElement("span", { class: "rd-cheat-keys" });
      row.keys.forEach((k, i) => {
        if (i > 0) { keys.append(" "); }
        keys.append(renderElement("kbd", {}, k));
      });
      column.append(renderElement("div", { class: "rd-cheat-row" }, renderElement("span", {}, row.label), keys));
    }
    card.append(grid);
    if (!this.ctx.prefs.vimKeys) {
      card.append(renderElement("div", { class: "rd-cheat-note" }, "Enable labshelf.reader.vimKeys for single-key vim navigation (j/k, gg/G, /, n/N, H/L)."));
    }
    this.el.replaceChildren(card);
    this.el.classList.add("rd-open");
  }
}
