/**
 * Shows the floating page/zoom pill at the bottom-right: the only always-visible chrome. The page number is an editable go-to-page field; the zoom label opens the fit menu.
 */
import { formatZoomLabel } from "../../navigation/index.js";
import type { ZoomKind } from "../../index.js";
import { DOCUMENT_REPLACED, type ReaderContext } from "../session/index.js";
import { renderReaderIconButton } from "../elements/index.js";
import { renderIcon } from "../../../ui/index.js";
import { buildMenu, updatePopoverOpen, type MenuItem } from "../elements/index.js";
import type { Zoom } from "../navigation/index.js";
import { findElement, renderElement } from "../../../ui/dom/index.js";

const PERCENT_CHOICES = [50, 75, 100, 125, 150, 200, 300, 400];
const PREVIEW_PERCENT_CHOICES = [50, 75, 100, 125, 150, 200];
const PRESETS = ["page-width", "page-fit", "page-actual", "auto"];

export class PagePill {
  private readonly pageInput: HTMLInputElement;
  private readonly zoomBtn: HTMLButtonElement;
  private readonly zoomText: HTMLElement;
  private readonly totalLabel: HTMLElement;

  constructor(
    private readonly ctx: ReaderContext,
    private readonly zoom: Zoom,
    private readonly goToPage: (page: number) => void,
  ) {
    this.pageInput = renderElement("input", {
      class: "rd-page-input",
      type: "text",
      inputmode: "numeric",
      "aria-label": "Go to page",
      title: "Go to page",
    });
    this.totalLabel = renderElement("span", { class: "rd-page-total" });
    this.zoomBtn = renderElement("button", { class: "rd-zoom-label", type: "button", title: "Zoom options", "aria-haspopup": "menu" });
    this.zoomText = renderElement("span", {});
    this.zoomBtn.append(this.zoomText);
    const out = renderReaderIconButton(renderIcon("minus"), "Zoom out", "rd-btn-sm");
    const inn = renderReaderIconButton(renderIcon("plus"), "Zoom in", "rd-btn-sm");
    out.addEventListener("click", () => zoom.zoomOut());
    inn.addEventListener("click", () => zoom.zoomIn());
    this.zoomBtn.addEventListener("click", () => this.openZoomMenu());

    this.pageInput.addEventListener("focus", () => this.pageInput.select());
    this.pageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { this.commitPage(); this.pageInput.blur(); ctx.container.focus({ preventScroll: true }); }
      if (e.key === "Escape") { this.sync(); this.pageInput.blur(); ctx.container.focus({ preventScroll: true }); }
    });
    this.pageInput.addEventListener("blur", () => this.sync());

    const pageGroup = renderElement("div", { class: "rd-pill-group" }, this.pageInput, this.totalLabel);
    const zoomGroup = renderElement("div", { class: "rd-pill-group" }, out, this.zoomBtn, inn);
    if (ctx.boot.preview) {
      // The preview header reads left to right as navigation, then zoom: arrows, page box, "/ N", rule, − + and the label.
      const prev = renderReaderIconButton(renderIcon("chevron-up"), "Previous page", "rd-btn-sm");
      const next = renderReaderIconButton(renderIcon("chevron-down"), "Next page", "rd-btn-sm");
      prev.addEventListener("click", () => ctx.pdfViewer.previousPage());
      next.addEventListener("click", () => ctx.pdfViewer.nextPage());
      this.zoomBtn.append(renderElement("span", { class: "rd-zoom-caret", html: renderIcon("chevron-down"), "aria-hidden": "true" }));
      zoomGroup.replaceChildren(out, inn, this.zoomBtn);
      pageGroup.prepend(prev, next);
    }
    findElement("status-pill").append(pageGroup, renderElement("div", { class: "rd-pill-sep" }), zoomGroup);

    ctx.eventBus.on("pagechanging", () => this.sync());
    ctx.eventBus.on("scalechanging", () => this.sync());
    ctx.eventBus.on(DOCUMENT_REPLACED, () => this.showTotal());
    this.showTotal();
  }

  /**
   * Focuses the page-number field for a keyboard-driven go-to-page.
   */
  focusPageInput(): void {
    this.pageInput.focus();
  }

  private showTotal(): void {
    const total = String(this.ctx.pdfDocument.numPages);
    this.pageInput.size = total.length;
    this.totalLabel.textContent = `/ ${total}`;
    this.sync();
  }

  private sync(): void {
    if (document.activeElement !== this.pageInput) {
      this.pageInput.value = String(this.ctx.pdfViewer.currentPageNumber);
    }
    this.zoomText.textContent = formatZoomLabel(this.zoom.scale);
  }

  private commitPage(): void {
    const n = parseInt(this.pageInput.value, 10);
    if (Number.isInteger(n) && n >= 1 && n <= this.ctx.pdfDocument.numPages) { this.goToPage(n); }
    this.sync();
  }

  private openZoomMenu(): void {
    const preview = this.ctx.boot.preview;
    const value = this.zoom.scaleValue;
    const presets: MenuItem[] = preview
      ? [this.presetItem("Fit width", "page-width"), this.presetItem("Fit height", "page-fit")]
      : [
        this.presetItem("Fit width", "page-width"),
        this.presetItem("Fit page", "page-fit"),
        this.presetItem("Actual size", "page-actual"),
        this.presetItem("Automatic", "auto"),
      ];
    const percents = (preview ? PREVIEW_PERCENT_CHOICES : PERCENT_CHOICES).map((p, i): MenuItem => ({
      label: `${p}%`,
      separatorBefore: i === 0,
      checked: Math.round(this.zoom.scale * 100) === p && !PRESETS.includes(value),
      run: () => this.zoom.setScale(p / 100),
    }));
    updatePopoverOpen(this.zoomBtn, buildMenu([...presets, ...percents]), preview ? "below" : "above");
  }

  private presetItem(label: string, preset: ZoomKind): MenuItem {
    return { label, checked: this.zoom.scaleValue === preset, run: () => this.zoom.setPreset(preset) };
  }
}
