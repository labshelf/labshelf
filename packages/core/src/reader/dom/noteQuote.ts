// The passage a reader note is attached to, shown above its editor in the Notes tab and the floating note: clamped to three lines with a Show more toggle.
import { renderElement } from "../../ui/dom/index.js";

export class NoteQuote {
  readonly el = renderElement("div", { class: "rd-note-context" });
  private readonly observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => this.measure());
  private open = false;
  private last: { quote?: string | undefined; color?: string | undefined } = {};

  /** Collapses the quote again; called when another note is opened. */
  reset(): void { this.open = false; }

  /** Shows `quote` with an accent in the highlight's `color`, or nothing when there is no quote. */
  render(quote?: string, color?: string): void {
    this.last = { quote, color };
    this.observer?.disconnect();
    if (!quote) { this.el.replaceChildren(); return; }
    const block = renderElement("blockquote", { class: `rd-note-quote${this.open ? "" : " is-clamped"}` },
      renderElement("span", { class: `rd-note-accent ${color ? `rd-color-${color}` : ""}`.trim(), "aria-hidden": "true" }),
      renderElement("span", { class: "rd-note-quote-text" }, quote));
    const toggle = renderElement("button", { class: "rd-note-quote-toggle", type: "button", hidden: true, "aria-expanded": String(this.open) }, this.open ? "Show less" : "Show more");
    toggle.addEventListener("click", () => { this.open = !this.open; this.render(this.last.quote, this.last.color); });
    this.el.replaceChildren(block, toggle);
    this.observer?.observe(block);
  }

  disconnect(): void { this.observer?.disconnect(); }

  /** Offers the toggle only when the clamped quote actually hides text, or after it was expanded. */
  private measure(): void {
    const text = this.el.querySelector<HTMLElement>(".rd-note-quote-text");
    const toggle = this.el.querySelector<HTMLButtonElement>(".rd-note-quote-toggle");
    if (!text || !toggle) { return; }
    toggle.hidden = !this.open && text.scrollHeight <= text.clientHeight + 1;
  }
}
