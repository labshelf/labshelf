/** Rules for Springer Nature's SpringerLink and nature.com, which key PDFs by the DOI or the article id. */
import type { PublisherRule } from "../publisherRule.js";

const springerPdf = (doi: string): string => `https://link.springer.com/content/pdf/${doi}.pdf`;
const naturePdf = (id: string): string => `https://www.nature.com/articles/${id}.pdf`;

export const SPRINGER_NATURE_RULES: PublisherRule[] = [
  {
    platform: "Springer",
    hosts: /^link\.springer\.com$/i,
    // 10.1186 is BioMed Central, 10.1023 Kluwer; SpringerLink serves both.
    doi: { prefixes: ["10.1007", "10.1186", "10.1023"], pdfUrls: (doi) => [springerPdf(doi)] },
    landing: {
      path: /^\/(?:article|chapter)\/(10\.\d{4,9}\/[^?#]+)/i,
      pdfUrls: (m) => [springerPdf(decodeURIComponent(m[1]!))],
    },
    examples: [
      { from: "10.1186/s13059-014-0550-8", pdf: springerPdf("10.1186/s13059-014-0550-8") },
      { from: "https://link.springer.com/article/10.1007/s11263-015-0816-y", pdf: springerPdf("10.1007/s11263-015-0816-y") },
    ],
  },
  {
    platform: "Nature",
    hosts: /(^|\.)nature\.com$/i,
    // The article id is the DOI suffix for every journal on nature.com.
    doi: { prefixes: ["10.1038"], pdfUrls: (doi) => [naturePdf(doi.slice(doi.indexOf("/") + 1))] },
    landing: {
      path: /^\/articles\/([^/?#]+?)(?<!\.pdf)\/?(?:[?#]|$)/i,
      pdfUrls: (m) => [naturePdf(m[1]!)],
    },
    examples: [
      { from: "10.1038/s41586-020-2649-2", pdf: naturePdf("s41586-020-2649-2") },
      { from: "https://www.nature.com/articles/nbt.1754", pdf: naturePdf("nbt.1754") },
    ],
  },
];
