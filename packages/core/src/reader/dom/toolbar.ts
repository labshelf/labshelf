// Draws the reader's bars: the toolbar, the page pill, tab lists and the build banner.
import { initialAutohide, deriveToolbarVisibility, type AutohideEvent, type AutohideState, type ZoomKind } from "../index.js";
import { renderReaderIconButton, isPopoverOpen, onPopoverToggle, buildMenu, updatePopoverOpen, type MenuItem } from "./elements.js";
import { renderIcon } from "../../ui/index.js";
import { findElement, renderElement } from "../../ui/dom/index.js";
import { formatZoomLabel } from "../viewNavigation.js";
import type { ReaderContext } from "./readerSession.js";
import { DOCUMENT_REPLACED } from "./pdfLoader.js";
import type { Zoom } from "./navigation.js";

/**
 * Renders the overlay toolbar. It floats above the page (never part of the layout) so showing or hiding it cannot resize the viewer and trigger a re-raster.
 */

export interface ToolbarActions {
  toggleSidebar(): void;
  historyBack(): void;
  historyForward(): void;
  openFind(): void;
  openTheme(anchor: HTMLElement): void;
  openCheatsheet(): void;
}

export class Toolbar {
  private readonly el = findElement("toolbar");
  private readonly backBtn: HTMLButtonElement;
  private readonly forwardBtn: HTMLButtonElement;
  private readonly sidebarBtn: HTMLButtonElement;
  private state: AutohideState = initialAutohide;
  private lastScrollTop = 0;
  private pointerY: number | null = null;
  private findOpen = false;
  private autoHide: boolean;
  private engaged = false;

  constructor(
    private readonly container: HTMLElement,
    title: string,
    isMac: boolean,
    autoHide: boolean,
    actions: ToolbarActions,
  ) {
    this.autoHide = autoHide;
    const mod = isMac ? "Cmd" : "Ctrl";
    const alt = isMac ? "Option" : "Alt";
    this.sidebarBtn = renderReaderIconButton(renderIcon("panel-left"), "Toggle sidebar (F4)");
    this.backBtn = renderReaderIconButton(renderIcon("arrow-left"), `Back (${alt}+Left)`);
    this.forwardBtn = renderReaderIconButton(renderIcon("arrow-right"), `Forward (${alt}+Right)`);
    const findBtn = renderReaderIconButton(renderIcon("search"), `Find (${mod}+F)`);
    const themeBtn = renderReaderIconButton(renderIcon("droplet"), "Page theme");
    const helpBtn = renderReaderIconButton(renderIcon("help"), "Keyboard shortcuts (?)");
    this.backBtn.disabled = true;
    this.forwardBtn.disabled = true;

    this.sidebarBtn.addEventListener("click", actions.toggleSidebar);
    this.backBtn.addEventListener("click", actions.historyBack);
    this.forwardBtn.addEventListener("click", actions.historyForward);
    findBtn.addEventListener("click", actions.openFind);
    themeBtn.addEventListener("click", () => actions.openTheme(themeBtn));
    helpBtn.addEventListener("click", actions.openCheatsheet);

    this.el.append(
      renderElement("div", { class: "rd-toolbar-group" }, this.sidebarBtn, this.backBtn, this.forwardBtn),
      renderElement("div", { class: "rd-toolbar-title", title }, title),
      renderElement("div", { class: "rd-toolbar-group" }, findBtn, themeBtn, helpBtn),
    );

    this.bindAutohide();
  }

  /**
   * Enables or disables the back/forward buttons.
   */
  setHistoryState(canGoBack: boolean, canGoForward: boolean): void {
    this.backBtn.disabled = !canGoBack;
    this.forwardBtn.disabled = !canGoForward;
  }

  /**
   * Reflects the sidebar's open state on the toggle button.
   */
  setSidebarOpen(open: boolean): void {
    this.sidebarBtn.setAttribute("aria-pressed", open ? "true" : "false");
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
    for (const type of ["wheel", "touchmove", "pointerdown"] as const) {
      this.container.addEventListener(type, engage, { passive: true });
    }
    document.addEventListener("keydown", engage, { passive: true });

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
      findOpen: this.findOpen,
      menuOpen: isPopoverOpen(),
    });
    const changed = next.visible !== this.state.visible;
    this.state = next;
    if (changed) { this.render(); }
  }

  private render(): void {
    this.el.classList.toggle("rd-toolbar-hidden", !this.state.visible);
    document.documentElement.classList.toggle("rd-chrome-hidden", !this.state.visible);
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

// Shows a strip of tabs where arrow keys, Home and End move the selection with a roving tabindex.

/** One tab: its id, its visible label and the id of the panel it shows, when it has one. */
export interface TabSpec<T extends string> {
  id: T;
  label: string;
  controls?: string;
}

interface TabListOptions<T extends string> {
  /** The accessible name of the strip. */
  label: string;
  onSelect: (id: T) => void;
  /** The tab selected at first; the first tab when absent. */
  selected?: T;
}

export class TabList<T extends string> {
  readonly el: HTMLElement;
  private readonly buttons: HTMLButtonElement[];
  private current: number;

  constructor(private readonly tabs: ReadonlyArray<TabSpec<T>>, private readonly options: TabListOptions<T>) {
    this.el = renderElement("div", { class: "rd-tabs", role: "tablist", "aria-label": options.label });
    this.buttons = tabs.map(({ id, label, controls }) => {
      const button = renderElement("button", { class: "rd-tab", type: "button", role: "tab", text: label });
      if (controls !== undefined) { button.setAttribute("aria-controls", controls); }
      button.addEventListener("click", () => this.select(id));
      return button;
    });
    this.current = Math.max(0, tabs.findIndex((t) => t.id === options.selected));
    this.el.append(...this.buttons);
    this.el.addEventListener("keydown", (e) => this.onKey(e));
    this.mark();
  }

  get selected(): T { return this.tabs[this.current]!.id; }

  /** @returns the button of the tab `id`, for callers that relabel or restyle it. */
  button(id: T): HTMLButtonElement { return this.buttons[this.indexOf(id)]!; }

  /** Selects the tab `id` and reports it; `focus` also moves keyboard focus onto it. */
  select(id: T, focus = false): void {
    this.current = this.indexOf(id);
    this.mark();
    if (focus) { this.buttons[this.current]!.focus(); }
    this.options.onSelect(id);
  }

  private indexOf(id: T): number { return this.tabs.findIndex((t) => t.id === id); }

  private mark(): void {
    this.buttons.forEach((button, i) => {
      button.setAttribute("aria-selected", String(i === this.current));
      button.tabIndex = i === this.current ? 0 : -1;
    });
  }

  private onKey(e: KeyboardEvent): void {
    const last = this.tabs.length - 1;
    const step: Record<string, number> = { ArrowRight: this.current + 1, ArrowLeft: this.current - 1, Home: 0, End: last };
    const target = step[e.key];
    if (target === undefined) { return; }
    e.preventDefault();
    const wrapped = target < 0 ? last : target > last ? 0 : target;
    this.select(this.tabs[wrapped]!.id, true);
  }
}

// Reports a preview PDF that could not reload, at the top of the reader.

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
