// Asks for a review note on text selected in a build preview and sends it to the host as a comment at the source behind it.
import { renderElement } from "../../../ui/dom/index.js";
import { clamp } from "../elements/index.js";
import { pagePointAt, type PageViewportLike } from "../navigation/index.js";
import type { ReaderContext } from "../session/index.js";
import type { PagePoint } from "../../index.js";

/** The selected text, the page element it is on, and on screen its first line and its whole extent. */
export interface ReviewSelection {
  text: string;
  pageNumber: number;
  page: HTMLElement;
  start: DOMRect;
  bounds: DOMRect;
}

const MARGIN = 8;

export class ReviewNote {
  private readonly input = renderElement("textarea", { class: "rd-review-note-input", rows: "3", placeholder: "Comment on the source", "aria-label": "Comment" });
  private readonly box: HTMLElement;
  private pending: { point: PagePoint; quote: string } | null = null;

  constructor(private readonly ctx: ReaderContext) {
    const cancel = renderElement("button", { class: "rd-review-note-btn", type: "button", text: "Cancel" });
    const submit = renderElement("button", { class: "rd-review-note-btn rd-review-note-submit", type: "button", text: "Comment" });
    this.box = renderElement("div", { class: "rd-review-note", role: "dialog", "aria-label": "Comment on the source" },
      this.input, renderElement("div", { class: "rd-review-note-actions" }, cancel, submit));
    cancel.addEventListener("click", () => this.close());
    submit.addEventListener("click", () => this.submit());
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); this.close(); }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); this.submit(); }
    });
    document.body.append(this.box);
  }

  /** Opens the note under the selection; a page that pdf.js has not laid out yet gives no point, so nothing opens. */
  open(selection: ReviewSelection): void {
    const point = this.pointOf(selection);
    if (!point) { return; }
    this.pending = { point, quote: selection.text };
    this.input.value = "";
    this.box.classList.add("rd-visible");
    const own = this.box.getBoundingClientRect();
    const below = selection.bounds.bottom + MARGIN;
    const top = below + own.height <= window.innerHeight - MARGIN ? below : selection.bounds.top - own.height - MARGIN;
    this.box.style.top = `${clamp(top, MARGIN, window.innerHeight - own.height - MARGIN)}px`;
    this.box.style.left = `${clamp(selection.bounds.left, MARGIN, window.innerWidth - own.width - MARGIN)}px`;
    this.input.focus();
  }

  private submit(): void {
    const note = this.input.value.trim();
    if (!this.pending || !note) { this.input.focus(); return; }
    this.ctx.host.post({ command: "addReviewComment", point: this.pending.point, quote: this.pending.quote, note });
    this.close();
  }

  private close(): void {
    this.pending = null;
    this.box.classList.remove("rd-visible");
  }

  // The start of the selection's first line, which SyncTeX maps to the source line the quote begins on.
  private pointOf({ pageNumber, page, start }: ReviewSelection): PagePoint | undefined {
    const view = this.ctx.pdfViewer.getPageView(pageNumber - 1) as { viewport?: PageViewportLike } | undefined;
    if (!view?.viewport) { return undefined; }
    const box = page.getBoundingClientRect();
    const x = start.left + 1 - box.left - page.clientLeft;
    const y = start.top + start.height / 2 - box.top - page.clientTop;
    return pagePointAt(pageNumber, view.viewport, x, y);
  }
}
