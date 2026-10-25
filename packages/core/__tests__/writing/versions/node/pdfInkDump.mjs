// Prints, as JSON, each page's ink map as renderInkMaps builds it, with real pdf.js, which Jest cannot load (see jest.config.cjs),
// plus where given words sit, in PDF points from the page's top-left corner.
import { readFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const [pdfPath, scaleArg, ...words] = process.argv.slice(2);
const scale = Number(scaleArg);
const doc = await getDocument({ data: new Uint8Array(readFileSync(pdfPath)), disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
const pages = [];
const found = [];
for (let number = 1; number <= doc.numPages; number++) {
  const page = await doc.getPage(number);
  const viewport = page.getViewport({ scale });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  pages.push({ width, height, rgba: Buffer.from(context.getImageData(0, 0, width, height).data).toString("base64") });
  const pageHeight = viewport.height / scale;
  for (const item of (await page.getTextContent()).items) {
    for (const word of words) {
      if (item.str.includes(word)) { found.push({ word, page: number, x: item.transform[4], y: pageHeight - item.transform[5] }); }
    }
  }
}
process.stdout.write(JSON.stringify({ pages, found }));
