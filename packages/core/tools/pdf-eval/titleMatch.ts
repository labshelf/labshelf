// Scores how much of a paper's title appears in the first two pages of a PDF, to tell the right copy from a wrong one.
import { NodePdfOpener, createPdfjsLoader } from "../../src/import/node/index.js";
import { extractPageTexts } from "../../src/import/index.js";

const PAGES_READ = 2;
const MIN_WORD_LENGTH = 3;
const opener = new NodePdfOpener(createPdfjsLoader());

/** Lowercase words of three or more letters or digits; compatibility forms (ligatures) and accents are folded away. */
export function titleWords(text: string): string[] {
  const folded = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  return folded.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= MIN_WORD_LENGTH);
}

/** @returns the share (0-1) of the title's distinct words found in `text` */
export function wordShare(title: string, text: string): number {
  const wanted = new Set(titleWords(title));
  if (wanted.size === 0) return 0;
  const present = new Set(titleWords(text));
  return [...wanted].filter((word) => present.has(word)).length / wanted.size;
}

/** @returns the title's word share on pages 1-2 of the PDF; 0 when pdf.js cannot read it */
export async function titleScoreOfPdf(title: string, bytes: Uint8Array): Promise<number> {
  let document;
  try {
    document = await opener.open(bytes);
  } catch {
    return 0;
  }
  try {
    const pages = await extractPageTexts(document, PAGES_READ, undefined);
    return wordShare(title, pages.map((page) => page.text).join(" "));
  } finally {
    await document.destroy();
  }
}
