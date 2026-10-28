// Reads title blocks, identifier-detection text and link annotation targets from a PdfDocumentLike, and judges whether that text is readable.
import { formatError } from "../../errors/index.js";
import type { ILogger } from "../../ports/index.js";
import type { PageText, PdfDocumentLike, TextBlock } from "./pdfDocument.js";

const PDF_TEXT_MODULE = "import/pdf";

// TRAP: link annotation targets often carry the DOI even when the text layer is unreadable.

/**
 * Groups page-1 text items into runs that share the same font size, in reading order.
 * @returns Array of TextBlock objects representing font-grouped text runs.
 */
export async function extractTitleBlocks(document: PdfDocumentLike): Promise<TextBlock[]> {
  const page = await document.getPage(1);
  const content = await page.getTextContent();
  const items = content.items;

  const blocks: TextBlock[] = [];
  for (const item of items) {
    const str = item.str ?? "";
    if (!str.trim()) {
      continue;
    }
    const transform = item.transform ?? [1, 0, 0, 1, 0, 0];
    const size = Math.round(Math.hypot(transform[2] ?? 0, transform[3] ?? 1) * 10) / 10;

    const last = blocks[blocks.length - 1];
    if (last && Math.abs(last.size - size) < 1) {
      last.text += /\s$/.test(last.text) || /^\s/.test(str) ? str : ` ${str}`;
    } else {
      blocks.push({ size, text: str });
    }
  }

  return blocks
    .map((block) => ({ size: block.size, text: block.text.replace(/\s+/g, " ").trim() }))
    .filter((block) => block.text.length > 0);
}

/**
 * Returns the text of the first `pageCount` pages, one entry per page, with its page number.
 * Keeping pages apart is what makes a repeated running header detectable. A page that
 * cannot be read is logged and skipped, so one bad page does not cost the others.
 * @returns One entry per page that yielded text.
 */
export async function extractPageTexts(
  document: PdfDocumentLike,
  pageCount: number,
  logger: ILogger | undefined,
): Promise<PageText[]> {
  const pages: PageText[] = [];
  const limit = Math.min(document.numPages ?? pageCount, pageCount);

  for (let page = 1; page <= limit; page += 1) {
    try {
      const handle = await document.getPage(page);
      const textContent = await handle.getTextContent({ normalizeWhitespace: true });
      const text = textContent.items
        .map((item) => item.str ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) {
        pages.push({ page, text });
      }
    } catch (error) {
      await logger?.log("WARN", PDF_TEXT_MODULE, "Page text unreadable; skipping the page", {
        page,
        message: formatError(error),
      });
    }
  }

  return pages;
}

/**
 * Collects the target URLs of every link annotation on the first `pageCount` pages.
 * @returns Deduplicated list of annotation URLs; empty when the backend exposes none.
 */
export async function extractUrls(
  document: PdfDocumentLike,
  pageCount: number,
  logger: ILogger | undefined,
): Promise<string[]> {
  const urls = new Set<string>();
  const limit = Math.min(document.numPages ?? pageCount, pageCount);

  for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    if (typeof page.getAnnotations !== "function") {
      break;
    }

    const annotations = await page.getAnnotations().catch(async (error: unknown) => {
      await logger?.log("WARN", PDF_TEXT_MODULE, "Link annotations unreadable; skipping the page", {
        page: pageNumber,
        message: formatError(error),
      });
      return [];
    });
    for (const annotation of annotations) {
      for (const candidate of [annotation.url, annotation.unsafeUrl]) {
        if (typeof candidate === "string" && candidate.trim()) {
          urls.add(candidate.trim());
        }
      }
    }
  }

  return [...urls];
}

// Judges whether the text extracted from a PDF is readable natural language.

// Function words across the languages LabShelf papers are most often written
// in. Natural prose is densely populated with them; text recovered from a PDF
// whose fonts lack a usable ToUnicode map is not.
const FUNCTION_WORDS = new Set([
  "the", "of", "and", "in", "to", "for", "with", "that", "this", "are", "was", "were", "from", "not",
  "we", "our", "have", "has", "been", "which", "these", "their", "between", "than", "also", "such", "here",
  "de", "da", "do", "das", "dos", "que", "para", "com", "uma", "como", "por", "mais", "foi", "ser", "nos",
  "la", "el", "los", "las", "una", "por", "para", "con", "del", "les", "des", "une", "dans", "sur", "est",
  "und", "der", "die", "das", "den", "von", "mit", "ist", "auf", "ein", "eine", "nicht", "auch", "dem",
]);

/**
 * Reports whether extracted PDF text reads as natural language. Returns true
 * when there is too little text to judge, so short documents are not rejected.
 * @returns false only when the text is confidently unreadable (broken encoding).
 */
export function isNaturalText(text: string): boolean {
  const words = text.toLowerCase().match(/[a-zà-ÿ]{2,}/g) ?? [];
  if (words.length < 40) {
    return true;
  }

  let hits = 0;
  for (const word of words) {
    if (FUNCTION_WORDS.has(word)) {
      hits += 1;
    }
  }
  return hits / words.length >= 0.04;
}

// A paper's first page holds hundreds of words. Fewer than this on every page
// means the text layer is a print header or a download stamp laid over pages
// that are stored as images or outlines.
const MIN_PAGE_WORDS = 40;

/**
 * Reports whether the text layer is too thin to describe the paper — a scan,
 * or a page re-printed from a browser, which draws its glyphs as vector paths.
 * Judged per page: the same stamp on three pages is still only a stamp.
 * @returns true when no page holds as many words as a real page of a paper.
 */
export function isSparseText(pageTexts: string[]): boolean {
  return pageTexts.every((text) => (text.match(/[a-zà-ÿ]{2,}/gi) ?? []).length < MIN_PAGE_WORDS);
}
