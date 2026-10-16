/** Rules for commercial publishers' own platforms: Elsevier, IEEE, De Gruyter, Thieme and BMJ. */
import type { PublisherRule } from "../publisherRule.js";

const sciencePdf = (pii: string): string => `https://www.sciencedirect.com/science/article/pii/${pii}/pdfft?isDTMRedir=true&download=true`;
const degruyterPdf = (doi: string): string => `https://www.degruyterbrill.com/document/doi/${doi}/pdf`;
const thiemePdf = (doi: string): string => `https://www.thieme-connect.com/products/ejournals/pdf/${doi}.pdf`;

export const COMMERCIAL_PUBLISHER_RULES: PublisherRule[] = [
  {
    platform: "ScienceDirect",
    // linkinghub is where doi.org sends Elsevier DOIs; its URL carries the PII too.
    hosts: /(^|\.)(sciencedirect\.com|linkinghub\.elsevier\.com)$/i,
    landing: {
      path: /^\/(?:science\/article\/(?:abs\/)?pii|retrieve\/pii)\/([0-9A-Z]+)/i,
      // "pdfft" answers with an interstitial the downloader follows.
      pdfUrls: (m) => [sciencePdf(m[1]!)],
    },
    examples: [
      { from: "https://www.sciencedirect.com/science/article/abs/pii/S0893608014002135", pdf: sciencePdf("S0893608014002135") },
      { from: "https://linkinghub.elsevier.com/retrieve/pii/S0893608014002135", pdf: sciencePdf("S0893608014002135") },
    ],
  },
  {
    platform: "IEEE Xplore",
    hosts: /^ieeexplore\.ieee\.org$/i,
    landing: {
      path: /^\/(?:abstract\/)?document\/(\d+)/i,
      pdfUrls: (m) => [`https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=${m[1]}`],
    },
    examples: [{ from: "https://ieeexplore.ieee.org/document/726791", pdf: "https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=726791" }],
  },
  {
    platform: "De Gruyter",
    hosts: /(^|\.)(degruyterbrill|degruyter)\.com$/i,
    doi: { prefixes: ["10.1515"], pdfUrls: (doi) => [degruyterPdf(doi)] },
    landing: {
      path: /^\/document\/doi\/(10\.\d{4,9}\/[^?#]+?)\/html\b/i,
      pdfUrls: (m) => [degruyterPdf(m[1]!)],
    },
    examples: [
      { from: "10.1515/jaa-2019-0017", pdf: degruyterPdf("10.1515/jaa-2019-0017") },
      { from: "https://www.degruyterbrill.com/document/doi/10.1515/jaa-2019-0017/html", pdf: degruyterPdf("10.1515/jaa-2019-0017") },
    ],
  },
  {
    platform: "Thieme",
    hosts: /(^|\.)thieme-connect\.(com|de)$/i,
    doi: { prefixes: ["10.1055"], pdfUrls: (doi) => [thiemePdf(doi)] },
    landing: {
      path: /^\/products\/ejournals\/(?:abstract|html)\/(10\.\d{4,9}\/[^?#]+)/i,
      pdfUrls: (m) => [thiemePdf(m[1]!)],
    },
    examples: [
      { from: "10.1055/s-0032-1331772", pdf: thiemePdf("10.1055/s-0032-1331772") },
      { from: "https://www.thieme-connect.com/products/ejournals/abstract/10.1055/s-0032-1331772", pdf: thiemePdf("10.1055/s-0032-1331772") },
    ],
  },
  {
    platform: "BMJ",
    hosts: /(^|\.)bmj\.com$/i,
    // The DOI lacks the volume, so only the landing page gives the PDF. Ids look like "bmj.n71"; "/content/70/1/1" is another shape.
    landing: {
      path: /^\/content\/(\d+)\/([a-z]+\.[\w.-]+?)(?<!\.pdf)(?:\.full)?\/?(?:\?.*)?$/i,
      pdfUrls: (m, page) => [`https://${page.host}/content/${m[1]}/${m[2]}.full.pdf`],
    },
    examples: [{ from: "https://www.bmj.com/content/372/bmj.n71", pdf: "https://www.bmj.com/content/372/bmj.n71.full.pdf" }],
  },
];
