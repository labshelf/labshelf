// Browser deck export: Export HTML downloads the single-file deck; Export PDF downloads the Helper's PDF or opens the single-file HTML to print.
import { exportDeckHtml, formatError } from "@labshelf/core";
import { helperCanPrintPdf, type HelperPrintResult, type ILatexHelper } from "@labshelf/core/helper";
import type { downloadBytes, openBlobTab } from "../../platform/bx";
import type { DeckAssetResolver } from "./deckAssets";

type DeckMathLoader = () => Promise<{ renderMathSvg(tex: string, display: boolean): string }>;

export interface DeckExportPorts {
  /** The page's Helper client, or undefined when there is none. */
  helper: () => ILatexHelper | undefined;
  download: typeof downloadBytes;
  openTab: typeof openBlobTab;
  notify: (message: string) => void;
  loadMath?: DeckMathLoader;
}

const INSTALL_HELPER = "The deck opened for printing. Install LabShelf Helper to save PDFs automatically.";
const INSTALL_CHROMIUM = "The deck opened for printing. Install Chromium or Chrome to save PDFs automatically.";

type Outcome = "pdf" | "html" | "fallback";

/**
 * Exports a deck as the single-file HTML (original assets) or as a PDF. A PDF is the Helper's when it can print; otherwise the HTML
 * opens in a tab with `#print` and a message says what saves PDFs automatically.
 * @returns what was produced: `fallback` when the print tab opened or the deck could not be exported
 */
export async function exportDeckFromBrowser(
  format: "pdf" | "html",
  deck: { html: string; theme: string; name: string; size: string; assets: DeckAssetResolver },
  ports: DeckExportPorts,
): Promise<Outcome> {
  let single: string;
  try {
    const math = ports.loadMath ? await ports.loadMath() : undefined;
    single = await exportDeckHtml(deck.html, {
      theme: deck.theme,
      readAsset: deck.assets.original,
      ...(math && { renderMath: math.renderMathSvg }),
    });
  } catch (error) {
    ports.notify(formatError(error));
    return "fallback";
  }

  if (format === "html") {
    await ports.download(new TextEncoder().encode(single), `${deck.name}.html`, "text/html");
    return "html";
  }

  let message = INSTALL_HELPER;
  const helper = ports.helper();
  if (helper && helperCanPrintPdf(helper.status())) {
    const result = await helper.printPdf({ html: single, size: deck.size }, new AbortController().signal)
      .catch((error: unknown): HelperPrintResult => ({ ok: false, reason: "failed", message: formatError(error) }));
    if (result.ok) {
      await ports.download(result.pdf, `${deck.name}.pdf`, "application/pdf");
      return "pdf";
    }
    if (result.reason === "noChromium") message = INSTALL_CHROMIUM;
    else if (result.reason === "limit" || result.reason === "failed") ports.notify(`PDF export failed: ${result.message}`);
  }
  await ports.openTab(single, "text/html", "print");
  ports.notify(message);
  return "fallback";
}
