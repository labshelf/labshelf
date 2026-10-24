/**
 * Shows the `?` overlay listing every active shortcut, generated from the keymap so it can never drift from the real bindings.
 */
import { cheatsheetRows } from "../../navigation/index.js";
import type { ReaderContext } from "../session/index.js";
import { $, el } from "../../../ui/dom/index.js";

export class Cheatsheet {
  private readonly el = $("cheatsheet");

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
    const rows = cheatsheetRows({ vimKeys: this.ctx.prefs.vimKeys, isMac: this.ctx.boot.isMac, preview: this.ctx.boot.preview });
    const card = el("div", { class: "rd-cheat-card", role: "dialog", "aria-label": "Keyboard shortcuts" });
    card.append(el("div", { class: "rd-cheat-title" }, "Keyboard shortcuts"));
    const grid = el("div", { class: "rd-cheat-grid" });
    let group = "";
    let column: HTMLElement | null = null;
    for (const row of rows) {
      if (row.group !== group || !column) {
        group = row.group;
        column = el("div", { class: "rd-cheat-col" }, el("div", { class: "rd-cheat-group" }, group));
        grid.append(column);
      }
      const keys = el("span", { class: "rd-cheat-keys" });
      row.keys.forEach((k, i) => {
        if (i > 0) { keys.append(" "); }
        keys.append(el("kbd", {}, k));
      });
      column.append(el("div", { class: "rd-cheat-row" }, el("span", {}, row.label), keys));
    }
    card.append(grid);
    if (!this.ctx.prefs.vimKeys) {
      card.append(el("div", { class: "rd-cheat-note" }, "Enable labshelf.reader.vimKeys for single-key vim navigation (j/k, gg/G, /, n/N, H/L)."));
    }
    this.el.replaceChildren(card);
    this.el.classList.add("rd-open");
  }
}
