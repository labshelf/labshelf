// Applies the selected colour preset to the PDF reader.
import type { PdfTheme } from "../../../model/index.js";
import type { PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs" with { "resolution-mode": "import" };
import { type EffectiveTheme, findPagePreset, derivePageColors } from "../../index.js";

export type PageColors = { background: string; foreground: string } | null;

const REFRESH_DELAY_MS = 80;

export class ThemeController {
  preference: PdfTheme;
  effective: EffectiveTheme;
  private bg: string;
  /** The page preset the preview pins; null follows the effective theme. */
  private pagesLock: EffectiveTheme | null = null;
  private text: string;
  private pdfViewer: PDFViewer | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners: Array<() => void> = [];
  private readonly effectiveListeners: Array<(effective: EffectiveTheme) => void> = [];

  constructor(private readonly container: HTMLElement, preference: PdfTheme, effective: EffectiveTheme) {
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
   * Applies a theme preference/effective pair: updates the chrome's data attribute and, unless the pages are locked, the page preset colours.
   */
  apply(preference: PdfTheme | undefined, effective: EffectiveTheme | undefined): void {
    if (preference) { this.preference = preference; }
    if (!effective) { return; }
    this.effective = effective;
    document.documentElement.dataset["pdfTheme"] = effective;
    if (this.pagesLock === null) {
      const preset = findPagePreset(effective);
      this.applyPageColors(preset.bg, preset.text);
    }
    for (const fn of this.effectiveListeners) { fn(effective); }
  }

  /**
   * Pushes explicit background/text colours into the container and, once changed, into pdf.js' pageColors.
   */
  applyPageColors(bg: string, text: string): void {
    this.bg = bg;
    this.text = text;
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
