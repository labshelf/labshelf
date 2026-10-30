// Applies the reader theme (a preset or a custom one) and shows the shortcut cheatsheet.
import type { PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { CustomReaderTheme, ReaderThemeRef } from "../../model/index.js";
import { type EffectiveTheme, findPagePreset, derivePageColors } from "../index.js";
import type { ReaderContext } from "./readerSession.js";
import { renderElement, findElement } from "../../ui/dom/index.js";
import { deriveReaderTheme, isLightColour, readerThemeCssVars } from "../../ui/tokens/index.js";
import { deriveCheatsheetRows } from "../keymap.js";

// Applies the selected colour preset to the PDF reader.

type PageColors = { background: string; foreground: string } | null;

const REFRESH_DELAY_MS = 80;

export class ThemeController {
  preference: ReaderThemeRef;
  effective: EffectiveTheme;
  /** The library's custom themes, for the appearance popover. */
  customThemes: CustomReaderTheme[] = [];
  private bg: string;
  /** The page preset the preview pins; null follows the effective theme. */
  private pagesLock: EffectiveTheme | null = null;
  private text: string;
  private pdfViewer: PDFViewer | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners: Array<() => void> = [];
  private readonly effectiveListeners: Array<(effective: EffectiveTheme) => void> = [];
  private readonly themeListeners: Array<() => void> = [];
  /** The custom properties a custom theme set inline on <html>, cleared when a preset returns. */
  private inlineVars: string[] = [];

  constructor(private readonly container: HTMLElement, preference: ReaderThemeRef, effective: EffectiveTheme) {
    this.preference = preference;
    this.effective = effective;
    const preset = findPagePreset(effective);
    this.bg = preset.bg;
    this.text = preset.text;
    this.apply(preference, effective);
  }

  /**
   * Supplies the PDFViewer instance once it exists, so later theme changes can push pageColors into it.
   */
  attach(pdfViewer: PDFViewer): void {
    this.pdfViewer = pdfViewer;
  }

  get pageColors(): PageColors { return derivePageColors(this.bg, this.text); }
  /** The preset the page pixels are drawn with: the lock while one is set, otherwise the effective theme. */
  get pageTheme(): EffectiveTheme { return this.pagesLock ?? this.effective; }
  get colors(): { bg: string; text: string } { return { bg: this.bg, text: this.text }; }

  /**
   * Fires after the page colours actually changed, so thumbnails and previews can re-render.
   */
  onPageColorsChange(fn: () => void): void { this.listeners.push(fn); }

  /**
   * Fires on every applied effective theme, whether it came from boot's init message or a later applyTheme.
   */
  onEffectiveChange(fn: (effective: EffectiveTheme) => void): void { this.effectiveListeners.push(fn); }

  /** Fires when the selected theme or the custom theme list changes, so an open popover can redraw. */
  onThemesChange(fn: () => void): void { this.themeListeners.push(fn); }

  setCustomThemes(themes: CustomReaderTheme[]): void {
    this.customThemes = themes;
    for (const fn of this.themeListeners) { fn(); }
  }

  /**
   * Pins the pages to one preset: later themes update the chrome only. The preview uses it so pages stay light paper unless Dark PDF is pressed.
   */
  lockPages(preset: "light" | "dark"): void {
    this.pagesLock = preset;
    document.documentElement.dataset["pdfPages"] = preset;
    this.container.style.background = "";
    const colors = findPagePreset(preset);
    this.applyPageColors(colors.bg, colors.text);
  }

  /**
   * Applies a theme preference/effective pair: updates the chrome's data attribute and, unless the pages are locked, the page colours.
   * A custom theme also sets the chrome tokens inline on <html>, derived from its page and ink; a preset clears them.
   */
  apply(preference: ReaderThemeRef | undefined, effective: EffectiveTheme | undefined, customTheme?: CustomReaderTheme): void {
    if (preference) { this.preference = preference; }
    if (!effective) { return; }
    this.effective = effective;
    const root = document.documentElement;
    root.dataset["pdfTheme"] = effective;
    for (const name of this.inlineVars) { root.style.removeProperty(name); }
    this.inlineVars = [];
    if (customTheme) {
      for (const [name, value] of Object.entries(readerThemeCssVars(deriveReaderTheme(customTheme.page, customTheme.ink)))) {
        root.style.setProperty(name, value);
        this.inlineVars.push(name);
      }
    }
    if (this.pagesLock === null) {
      const colors = customTheme ? { bg: customTheme.page, text: customTheme.ink } : findPagePreset(effective);
      this.applyPageColors(colors.bg, colors.text);
    }
    for (const fn of this.effectiveListeners) { fn(effective); }
    for (const fn of this.themeListeners) { fn(); }
  }

  /**
   * Pushes explicit background/text colours into the container and, once changed, into pdf.js' pageColors.
   */
  applyPageColors(bg: string, text: string): void {
    this.bg = bg;
    this.text = text;
    this.container.dataset["pdfLinkTone"] = isLightColour(bg) ? "dark" : "light";
    // A locked page preset leaves the desk to the preview stylesheet.
    if (this.pagesLock === null) { this.container.style.background = bg; }
    const viewer = this.pdfViewer;
    if (!viewer) { return; }
    const colors = derivePageColors(bg, text);
    const cur = viewer.pageColors as PageColors;
    const same = (colors === null && cur === null)
      || (colors !== null && cur !== null && cur.background === colors.background && cur.foreground === colors.foreground);
    if (same) { return; }
    viewer.pageColors = colors;
    if (this.refreshTimer) { clearTimeout(this.refreshTimer); }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      // PLATFORM: refresh can CSS-scale capped canvases, retaining their colours and detail view; reset forces a fresh raster.
      for (let index = 0; index < viewer.pagesCount; index++) {
        const page = viewer.getPageView(index);
        page.pageColors = viewer.pageColors;
        page.reset();
      }
      viewer.update();
      for (const fn of this.listeners) { fn(); }
    }, REFRESH_DELAY_MS);
  }
}

/**
 * Shows the `?` overlay listing every active shortcut, generated from the keymap so it can never drift from the real bindings.
 */

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
