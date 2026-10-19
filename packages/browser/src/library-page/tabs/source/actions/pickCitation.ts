// Asks which library paper to cite and which of its highlights, reading the highlights from the paper's sidecar.
import {
  CITE_WITHOUT_PAGE, PaperDataStore, highlightLabel, highlightPage, paperPickText, quotableHighlights,
  type Annotation, type HighlightChoice, type ILogger, type LibraryFileSystem, type PaperRecord,
} from "@labshelf/core";
import { quickPick, toast, type QuickPickEntry } from "@labshelf/core/dom";
import { createSidecarPort } from "../../../../storage";

const MODULE = "tabs.source";

export async function pickPaper(papers: () => Promise<PaperRecord[]>): Promise<PaperRecord | undefined> {
  const all = await papers();
  if (all.length === 0) {
    toast("LabShelf library is empty.", "info");
    return undefined;
  }
  return quickPick(all.map((paper) => {
    const { label, description, detail } = paperPickText(paper);
    return { label, description: `${description} · ${detail}`, value: paper };
  }), { title: "Cite from Library", placeholder: "Pick the paper to cite" });
}

/** One entry per highlight under the heading of how it is cited. */
function highlightEntries(heading: string, highlights: readonly Annotation[], quote: boolean): QuickPickEntry<HighlightChoice>[] {
  return [
    { kind: "separator", label: heading },
    ...highlights.map((highlight) => ({
      label: highlightLabel(highlight), description: highlightPage(highlight), value: { highlight, quote },
      ...(quote ? { icon: "quote" as const } : {}),
    })),
  ];
}

/** A paper whose highlights cannot be read is still cited, without a page. */
async function readHighlights(fs: LibraryFileSystem, logger: ILogger, paper: PaperRecord): Promise<Annotation[]> {
  try {
    return quotableHighlights(await new PaperDataStore(createSidecarPort(fs), { logger }).getAnnotations(paper.id));
  } catch (error) {
    void logger.log("WARN", MODULE, "Highlights of a paper could not be read; citing without a page", { paperId: paper.id, error: String(error) });
    return [];
  }
}

/** Undefined when the picker is dismissed. */
export async function pickHighlight(fs: LibraryFileSystem, logger: ILogger, paper: PaperRecord): Promise<HighlightChoice | undefined> {
  const highlights = await readHighlights(fs, logger, paper);
  if (highlights.length === 0) return { quote: false };
  return quickPick<HighlightChoice>([
    { label: CITE_WITHOUT_PAGE, value: { quote: false } },
    ...highlightEntries("Cite with page", highlights, false),
    ...highlightEntries("Cite with quotation", highlights, true),
  ], { title: "Cite from Library", placeholder: "Pick a highlight to cite its page" });
}
