// Counts the pages of a PDF that hold the paper's body, from the text layer of every page.
import type { PDFDocumentProxy } from "pdfjs-dist";
import { derivePaperBody, derivePdfTextLines, type PdfTextItem } from "../../../writing/checks/index.js";

/** @returns the pages before the references, or all pages when the PDF has no references heading. */
export async function countBodyPages(document: PDFDocumentProxy): Promise<number> {
  const pages: string[][] = [];
  for (let number = 1; number <= document.numPages; number++) {
    const content = await (await document.getPage(number)).getTextContent();
    // PLATFORM: pdf.js types marked-content entries beside text items; only items carry `str`.
    pages.push(derivePdfTextLines(content.items.filter((item): item is typeof item & PdfTextItem => "str" in item)));
  }
  return derivePaperBody(pages).contentPages;
}
