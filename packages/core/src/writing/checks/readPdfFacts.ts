/** Reads the facts the pre-submission check needs from a PDF through pdf.js: text lines, fonts, placed images and the info dictionary. */
import type { PdfjsLoader } from "../../import/index.js";
import type { LibraryFileSystem } from "../../ports/index.js";
import type { PdfFacts, PdfPageFacts } from "./checkReport.js";
import { walkOperators, type OperatorList } from "./operatorWalk.js";
import { pdfTextLines, type PdfTextItem } from "./pdfTextLines.js";

interface FontObject { name?: string; isType3Font?: boolean }

interface CheckPage {
  getOperatorList(): Promise<OperatorList>;
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  commonObjs: { has(id: string): boolean; get(id: string): unknown };
}

interface CheckDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<CheckPage>;
  getMetadata(): Promise<{ info?: Record<string, unknown> }>;
}

async function pageFacts(page: CheckPage, OPS: Record<string, number>): Promise<PdfPageFacts> {
  // INVARIANT: a page's fonts are in commonObjs once its operator list has resolved.
  const { fontIds, images } = walkOperators(await page.getOperatorList(), OPS);
  const fonts = fontIds.map((id) => {
    const font = (page.commonObjs.has(id) ? page.commonObjs.get(id) : undefined) as FontObject | undefined;
    return { name: font?.name ?? id, type3: font?.isType3Font === true };
  });
  return { lines: pdfTextLines((await page.getTextContent()).items), fonts, images };
}

function textFields(info: Record<string, unknown> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(info ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export async function readPdfFacts(fs: LibraryFileSystem, pdfjs: PdfjsLoader, pdfPath: string): Promise<PdfFacts> {
  const bytes = await fs.readFile(pdfPath);
  // Font faces are for drawing; the check only reads font descriptions.
  const task = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true });
  try {
    const document = (await task.promise) as unknown as CheckDocument;
    const { OPS } = (await pdfjs.load()) as { OPS: Record<string, number> };
    const pages: PdfPageFacts[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      pages.push(await pageFacts(await document.getPage(number), OPS));
    }
    return { pages, info: textFields((await document.getMetadata()).info) };
  } finally {
    // pdf.js 6 has no PDFDocumentProxy.destroy(); the loading task owns teardown.
    await task.destroy();
  }
}
