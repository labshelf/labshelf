// Reads the first page of a PDF as text, one line per line of the page, with the vendored pdf.js.
import { loadPdfjs } from "./loadPdfjs";

/** @returns the text of page 1 with a newline wherever pdf.js ends a line */
export async function firstPageText(bytes: Uint8Array): Promise<string> {
  const lib = await loadPdfjs();
  // pdf.js transfers the buffer to its worker; a private copy keeps the caller's bytes readable.
  const task = lib.getDocument({ data: new Uint8Array(bytes) });
  try {
    const page = await (await task.promise).getPage(1);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      text += item.hasEOL ? `${item.str}\n` : item.str;
    }
    return text;
  } finally {
    await task.destroy();
  }
}
