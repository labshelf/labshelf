// Turns the text items pdf.js reads from a page into the lines a reader sees.

/** The part of a pdf.js text item that carries text. */
export interface PdfTextItem { str?: string; hasEOL?: boolean }

/** pdf.js ends a line with an empty item flagged `hasEOL`; the items between are pieces of one line. */
export function pdfTextLines(items: readonly PdfTextItem[]): string[] {
  const lines: string[] = [];
  let line = "";
  for (const item of items) {
    line += item.str ?? "";
    if (item.hasEOL === true) { lines.push(line); line = ""; }
  }
  if (line !== "") { lines.push(line); }
  return lines;
}
