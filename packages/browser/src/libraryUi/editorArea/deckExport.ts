// Browser deck export: Export HTML downloads the single-file deck; Export PDF downloads the Helper's PDF or opens the single-file HTML to print.
import { addPrintMarks, exportDeckHtml, formatError, layoutTalkPdf, type PrintMarksOptions, type TalkPdfLayout, type TalkPdfNotes } from "@labshelf/core";
import { helperCanPrintPdf, type HelperPrintResult, type ILatexHelper } from "@labshelf/core/helper";
import type { downloadBytes, openBlobTab } from "../../platform";
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
const LAYOUT_NEEDS_HELPER = "Handouts and notes pages need the LabShelf Helper; printed as slides.";

type Outcome = "pdf" | "html" | "fallback";

/**
 * Exports a deck as the single-file HTML (original assets) or as a PDF. A PDF is the Helper's when it can print; otherwise the HTML
 * opens in a tab with `#print` and a message says what saves PDFs automatically. With `marks`, the Helper's PDF gets bleed and crop marks before
 * the download; with `talk`, it is laid out as a handout (`<name>-handout.pdf`) or notes pages (`<name>-notes.pdf`). The print tab applies
 * neither and says so for a layout.
 * @returns what was produced: `fallback` when the print tab opened or the deck could not be exported
 */
export async function exportDeckFromBrowser(
  format: "pdf" | "html",
  deck: { html: string; theme: string; name: string; size: string; assets: DeckAssetResolver; marks?: PrintMarksOptions | null; talk?: { layout: TalkPdfLayout; notes: TalkPdfNotes } | null },
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
    const { marks, talk } = deck;
    const finish = async (pdf: Uint8Array): Promise<Uint8Array> => {
      const marked = marks ? await addPrintMarks(pdf, marks) : pdf;
      return talk ? await layoutTalkPdf(marked, talk.layout, talk.notes) : marked;
    };
    const result = await helper.printPdf({ html: single, size: deck.size }, new AbortController().signal)
      .then(async (printed): Promise<HelperPrintResult> => (printed.ok ? { ok: true, pdf: await finish(printed.pdf) } : printed))
      .catch((error: unknown): HelperPrintResult => ({ ok: false, reason: "failed", message: formatError(error) }));
    if (result.ok) {
      const suffix = talk ? (talk.layout.kind === "handout" ? "-handout" : "-notes") : "";
      await ports.download(result.pdf, `${deck.name}${suffix}.pdf`, "application/pdf");
      return "pdf";
    }
    if (result.reason === "noChromium") message = INSTALL_CHROMIUM;
    else if (result.reason === "limit" || result.reason === "failed") ports.notify(`PDF export failed: ${result.message}`);
  }
  await ports.openTab(single, "text/html", "print");
  if (deck.talk) ports.notify(LAYOUT_NEEDS_HELPER);
  ports.notify(message);
  return "fallback";
}
