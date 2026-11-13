// Draws the reader's bars: the toolbar and the page pill.
import { initialAutohide, deriveToolbarVisibility, type AutohideEvent, type AutohideState, type ZoomKind } from "../index.js";
import type { AnnotationColor } from "../../model/index.js";
import { AnnotationColorPicker, renderReaderIconButton, isPopoverOpen, onPopoverToggle, buildMenu, updatePopoverOpen, type MenuItem } from "./elements.js";
import { renderIcon } from "../../ui/index.js";
import { openQuoteMenu } from "./selectionBubble.js";
import { findElement, renderElement } from "../../ui/dom/index.js";
import { formatZoomLabel } from "../viewNavigation.js";
import type { ReaderContext } from "./readerSession.js";
import { DOCUMENT_REPLACED } from "./pdfLoader.js";
import type { Zoom } from "./navigation.js";
import type { FloatingWindows } from "../../ui/dom/widgets/floatingWindow.js";
import { renderConsultChips } from "../../writing/consult/dom/consultFooter.js";
import { isReaderKeyEvent, readerRoot } from "./scope.js";

/**
 * Renders the overlay toolbar. It floats above the page (never part of the layout) so showing or hiding it cannot resize the viewer and trigger a re-raster.
 */

export interface ToolbarActions {
  toggleSidebar(): void;
  previousPage(): void;
  nextPage(): void;
  toggleDetails(): void;
  selectColor(color: AnnotationColor): void;
  selectTool(tool: "highlight" | "underline" | "note"): void;
  openFind(): void;
  toggleBoxTool(): void;
  toggleEquationTool(): void;
  openAppearance(anchor: HTMLElement): void;
  openCheatsheet(): void;
  /** Cites the paper in a writing project; absent in a build preview. */
  citeInProject?(): void;
  /** Copies the bare citation of the paper; present with `citeInProject`. */
  copyCitation?(): void;
}

/** The annotation tools (highlight, underline, note), each registered in `tools`, followed by the `rest` of the group. */
function renderToolGroup(actions: ToolbarActions, tools: Map<string, HTMLButtonElement>, rest: HTMLElement[]): HTMLElement {
  const group = renderElement("div", { class: "rd-toolbar-group rd-toolbar-tools", role: "group", "aria-label": "Annotations" });
  for (const [tool, label, icon] of [["highlight", "Highlight", "highlighter"], ["underline", "Underline", "underline"], ["note", "Add note", "note"]] as const) {
    const button = renderReaderIconButton(renderIcon(icon), label);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => actions.selectTool(tool));
    tools.set(tool, button);
    group.append(button);
  }
  group.append(...rest);
  group.addEventListener("mousedown", (event) => event.preventDefault());
  return group;
}

/** What the toolbar's Consult entry drives: the chooser and the consult windows its chips list. */
export interface ToolbarConsult { choose(): void; windows: FloatingWindows }

/** The group at the toolbar's end: Consult and its chips (hidden until setConsult), Find, Cite when the host offers it, Appearance, the shortcuts and the details toggle. */
function renderEndGroup(mod: string, actions: ToolbarActions, detailsBtn: HTMLButtonElement, consult: HTMLElement[]): HTMLElement {
  const findBtn = renderReaderIconButton(renderIcon("search"), `Find (${mod}+F)`);
  const appearanceBtn = renderReaderIconButton(renderIcon("text-size"), "Appearance");
  const helpBtn = renderReaderIconButton(renderIcon("help"), "Keyboard shortcuts (?)");
  findBtn.addEventListener("click", actions.openFind);
  appearanceBtn.addEventListener("click", () => actions.openAppearance(appearanceBtn));
  helpBtn.addEventListener("click", actions.openCheatsheet);
  const citeBtn = actions.citeInProject && renderReaderIconButton(renderIcon("quote"), "Cite…");
  const { citeInProject, copyCitation } = actions;
  if (citeBtn && citeInProject) {
    citeBtn.addEventListener("click", () => openQuoteMenu(citeBtn, { label: "Copy citation", icon: "copy", run: () => copyCitation?.() }, citeInProject, "below"));
  }
  return renderElement("div", { class: "rd-toolbar-group rd-toolbar-end" }, ...consult, findBtn, citeBtn, appearanceBtn, helpBtn, detailsBtn);
}

export class Toolbar {
  private readonly el = findElement("toolbar");
  private readonly previousBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly sidebarBtn: HTMLButtonElement;
  private readonly boxBtn: HTMLButtonElement;
  private readonly equationBtn: HTMLButtonElement;
  private readonly detailsBtn: HTMLButtonElement;
  private readonly colorPicker: AnnotationColorPicker;
  private readonly consultBtn: HTMLButtonElement;
  private readonly consultChips: HTMLElement;
  private consult: { value: ToolbarConsult; off(): void } | undefined;
  private readonly tools = new Map<string, HTMLButtonElement>();
  private state: AutohideState = initialAutohide;
  private lastScrollTop = 0;
  private pointerY: number | null = null;
  private findOpen = false;
  private autoHide: boolean;
  private engaged = false;

  constructor(
    private readonly container: HTMLElement,
    isMac: boolean,
    autoHide: boolean,
    actions: ToolbarActions,
  ) {
    this.autoHide = autoHide;
    const mod = isMac ? "Cmd" : "Ctrl";
    const alt = isMac ? "Option" : "Alt";
    this.sidebarBtn = renderReaderIconButton(renderIcon("panel-left"), "Toggle sidebar (F4)");
    this.previousBtn = renderReaderIconButton(renderIcon("chevron-up"), "Previous page");
    this.nextBtn = renderReaderIconButton(renderIcon("chevron-down"), "Next page");
    this.boxBtn = renderReaderIconButton(renderIcon("text-box"), `Text box (${mod}+${alt}+B)`);
    this.boxBtn.setAttribute("aria-pressed", "false");
    this.equationBtn = renderReaderIconButton(renderIcon("sigma"), `Extract equation (${mod}+${alt}+E)`);
    this.equationBtn.setAttribute("aria-pressed", "false");
    this.detailsBtn = renderReaderIconButton(renderIcon("panel-right"), "Toggle LabShelf Details");
    this.detailsBtn.addEventListener("click", actions.toggleDetails);
    this.colorPicker = new AnnotationColorPicker(actions.selectColor);
    this.consultBtn = renderReaderIconButton(renderIcon("book"), "Consult");
    this.consultBtn.hidden = true;
    this.consultBtn.addEventListener("click", () => this.consult?.value.choose());
    this.consultChips = renderElement("div", { class: "rd-toolbar-consult-chips" });
    this.consultChips.hidden = true;
    const editing = renderToolGroup(actions, this.tools, [this.boxBtn, this.equationBtn, this.colorPicker.el]);
    this.previousBtn.disabled = true;
    this.nextBtn.disabled = true;

    this.sidebarBtn.addEventListener("click", actions.toggleSidebar);
    this.previousBtn.addEventListener("click", actions.previousPage);
    this.nextBtn.addEventListener("click", actions.nextPage);
    this.boxBtn.addEventListener("click", actions.toggleBoxTool);
    this.equationBtn.addEventListener("click", actions.toggleEquationTool);

    this.el.append(
      renderElement("div", { class: "rd-toolbar-group" }, this.sidebarBtn, this.previousBtn, this.nextBtn),
      editing,
      renderEndGroup(mod, actions, this.detailsBtn, [this.consultBtn, this.consultChips]),
    );

    this.bindAutohide();
  }

  setPageState(page: number, total: number): void {
    this.previousBtn.disabled = page <= 1;
    this.nextBtn.disabled = page >= total;
  }

  setAnnotationColor(color: AnnotationColor): void { this.colorPicker.setColor(color); }

  setSelectionTool(tool: string | null): void {
    this.colorPicker.setVisible(tool === "highlight" || tool === "underline");
    for (const [name, button] of this.tools) { button.setAttribute("aria-pressed", String(name === tool)); }
  }

  setSidebarOpen(open: boolean): void {
    this.sidebarBtn.setAttribute("aria-pressed", open ? "true" : "false");
  }

  /**
   * Reflects the text-box creation mode on its toggle button.
   */
  setBoxToolActive(on: boolean): void {
    this.boxBtn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  /**
   * Hides the text-box button in readers that have no text boxes (the preview).
   */
  hideBoxTool(): void {
    this.boxBtn.hidden = true;
  }

  /**
   * Reflects the equation box mode on its toggle button.
   */
  setEquationToolActive(on: boolean): void {
    this.equationBtn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  /**
   * Shows the equation button only where the host can extract equations (not in the preview, not without the port).
   */
  setEquationToolAvailable(available: boolean): void {
    this.equationBtn.hidden = !available;
  }

  /**
   * Shows the Consult button and one chip per open consult window, or hides them with `undefined`; the toolbar stays visible while a window is open.
   */
  setConsult(consult: ToolbarConsult | undefined): void {
    this.consult?.off();
    this.consult = undefined;
    this.consultChips.replaceChildren();
    if (consult) {
      const chips = renderConsultChips(consult.windows);
      this.consultChips.append(chips.el);
      const offPin = consult.windows.onChange(() => this.step({ kind: "inputs" }));
      this.consult = { value: consult, off: () => { chips.destroy(); offPin(); } };
    }
    this.consultBtn.hidden = !consult;
    this.consultChips.hidden = !consult;
    this.step({ kind: "inputs" });
  }

  /**
   * Pins the toolbar visible while the find bar is open.
   */
  setFindOpen(open: boolean): void {
    this.findOpen = open;
    this.step({ kind: "inputs" });
  }

  /**
   * Applies the `labshelf.reader.toolbarAutoHide` setting.
   */
  setAutoHide(enabled: boolean): void {
    this.autoHide = enabled;
    this.step({ kind: "inputs" });
  }

  private bindAutohide(): void {
    // The bar stays put through pdf.js' own scrolling at open/restore; it starts auto-hiding once the reader moves.
    const engage = (): void => { this.engaged = true; };
    const engageKey = (e: KeyboardEvent): void => { if (isReaderKeyEvent(e)) { engage(); } };
    for (const type of ["wheel", "touchmove", "pointerdown"] as const) {
      this.container.addEventListener(type, engage, { passive: true });
    }
    document.addEventListener("keydown", engageKey, { passive: true });

    this.container.addEventListener("scroll", () => {
      const top = this.container.scrollTop;
      const delta = top - this.lastScrollTop;
      this.lastScrollTop = top;
      if (delta !== 0) { this.step({ kind: "scroll", delta }); }
    }, { passive: true });
    const shell = findElement("pdf-shell");
    shell.addEventListener("mousemove", (e) => {
      this.pointerY = e.clientY - shell.getBoundingClientRect().top;
      this.step({ kind: "inputs" });
    }, { passive: true });
    shell.addEventListener("mouseleave", () => { this.pointerY = null; this.step({ kind: "inputs" }); });
    this.el.addEventListener("focusin", () => this.step({ kind: "inputs" }));
    this.el.addEventListener("focusout", () => this.step({ kind: "inputs" }));
    onPopoverToggle(() => this.step({ kind: "inputs" }));
  }

  private step(event: AutohideEvent): void {
    const next = deriveToolbarVisibility(this.state, event, {
      enabled: this.autoHide,
      engaged: this.engaged,
      scrollTop: this.container.scrollTop,
      pointerY: this.pointerY,
      focusWithin: this.el.contains(document.activeElement),
      findOpen: this.findOpen || (this.consult?.value.windows.list().length ?? 0) > 0,
      menuOpen: isPopoverOpen(),
    });
    const changed = next.visible !== this.state.visible;
    this.state = next;
    if (changed) { this.render(); }
  }

  private render(): void {
    this.el.classList.toggle("rd-toolbar-hidden", !this.state.visible);
    readerRoot().classList.toggle("rd-chrome-hidden", !this.state.visible);
  }
}

/**
 * Shows the floating page/zoom pill at the bottom-right: the only always-visible chrome. The page number is an editable go-to-page field; the zoom label opens the fit menu.
 */

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
