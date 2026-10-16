/** Reads the link annotations of a real PDF, as the reader sees them, in page areas with the top-left origin. */
import { execFileSync } from "node:child_process";
import * as path from "node:path";

import type { PageArea } from "../../src/reader/index";

export interface PdfLink {
  area: PageArea;
  /** A named destination, or pdf.js's explicit destination array. */
  dest: string | unknown[] | null;
}

interface RawLink {
  page: number;
  view: [number, number, number, number];
  rect: [number, number, number, number];
  dest: string | unknown[] | null;
}

export function pdfLinks(pdfFile: string): PdfLink[] {
  const output = execFileSync(process.execPath, [path.join(__dirname, "pdfLinks.mjs"), pdfFile], { encoding: "utf8" });
  return (JSON.parse(output) as RawLink[]).map(({ page, view, rect, dest }) => ({
    area: { page, left: rect[0] - view[0], top: view[3] - rect[3], right: rect[2] - view[0], bottom: view[3] - rect[1] },
    dest,
  }));
}
