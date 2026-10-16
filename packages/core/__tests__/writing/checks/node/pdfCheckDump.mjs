// Prints, as JSON, what pdf.js reports for a PDF to the pre-submission check, with real pdf.js, which Jest cannot load (see jest.config.cjs).
import { readFileSync } from "node:fs";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

// Only these operators' arguments matter to the check; the rest (glyphs, paths) would bloat the dump.
const KEPT = new Set([OPS.save, OPS.restore, OPS.transform, OPS.setFont, OPS.paintImageXObject, OPS.paintFormXObjectBegin, OPS.paintFormXObjectEnd]);

const doc = await getDocument({ data: new Uint8Array(readFileSync(process.argv[2])), disableFontFace: true, verbosity: 0 }).promise;
const pages = [];
for (let number = 1; number <= doc.numPages; number++) {
  const page = await doc.getPage(number);
  const ops = await page.getOperatorList();
  const fonts = {};
  ops.fnArray.forEach((fn, i) => {
    if (fn !== OPS.setFont) { return; }
    const { name, isType3Font } = page.commonObjs.get(ops.argsArray[i][0]);
    fonts[ops.argsArray[i][0]] = { name, isType3Font };
  });
  const { items } = await page.getTextContent();
  pages.push({
    fnArray: [...ops.fnArray],
    argsArray: ops.argsArray.map((args, i) => (KEPT.has(ops.fnArray[i]) ? args : null)),
    fonts,
    items: items.map(({ str, hasEOL }) => ({ str, hasEOL })),
  });
}
const { info } = await doc.getMetadata();
process.stdout.write(JSON.stringify({ OPS, info, pages }));
