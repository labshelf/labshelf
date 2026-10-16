// Prints the link annotations of a PDF as JSON, with real pdf.js, which Jest cannot load (see jest.config.cjs).
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const doc = await getDocument({ data: new Uint8Array(readFileSync(process.argv[2])), verbosity: 0 }).promise;
const links = [];
for (let number = 1; number <= doc.numPages; number++) {
  const page = await doc.getPage(number);
  for (const annotation of await page.getAnnotations()) {
    if (annotation.subtype === "Link") { links.push({ page: number, view: page.view, rect: annotation.rect, dest: annotation.dest }); }
  }
}
process.stdout.write(JSON.stringify(links));
