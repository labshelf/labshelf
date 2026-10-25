/** Rules for learned societies, preprint servers and scholarly archives. */
import type { PublisherRule } from "../publisherRule.js";

const aclPdf = (id: string): string => `https://aclanthology.org/${id}.pdf`;
const aeaPdf = (doi: string): string => `https://www.aeaweb.org/articles/pdf/doi/${doi}`;
const jstorPdf = (id: string): string => `https://www.jstor.org/stable/pdf/${id}.pdf?acceptTC=true`;
const amsPdf = (journal: string, issue: string, pii: string): string =>
  `https://www.ams.org/journals/${journal.toLowerCase()}/${issue}/${pii}/${pii}.pdf`;

export const SOCIETY_AND_ARCHIVE_RULES: PublisherRule[] = [
  {
    platform: "ACL Anthology",
    openAccess: true,
    hosts: /^aclanthology\.org$/i,
    // ACL DOIs are 10.18653/v1/<anthology id>.
    doi: { prefixes: ["10.18653"], pdfUrls: (doi) => (doi.startsWith("10.18653/v1/") ? [aclPdf(doi.slice(12))] : []) },
    landing: { path: /^\/([A-Z]\d{2}-\d{4}|\d{4}\.[a-z0-9-]+\.\d+)\/?$/i, pdfUrls: (m) => [aclPdf(m[1]!)] },
    examples: [
      { from: "10.18653/v1/N19-1423", pdf: aclPdf("N19-1423") },
      { from: "https://aclanthology.org/2020.acl-main.1/", pdf: aclPdf("2020.acl-main.1") },
    ],
  },
  {
    platform: "AEA",
    hosts: /(^|\.)aeaweb\.org$/i,
    doi: { prefixes: ["10.1257"], pdfUrls: (doi) => [aeaPdf(doi)] },
    landing: {
      path: /^(?:\/articles\?id=|\/doi\/(?:abs\/|full\/)?)(10\.\d{4,9}\/[^&?#]+)/i,
      pdfUrls: (m) => [aeaPdf(decodeURIComponent(m[1]!))],
    },
    examples: [
      { from: "10.1257/aer.91.5.1369", pdf: aeaPdf("10.1257/aer.91.5.1369") },
      { from: "https://www.aeaweb.org/articles?id=10.1257/aer.91.5.1369", pdf: aeaPdf("10.1257/aer.91.5.1369") },
    ],
  },
  {
    platform: "AMS",
    hosts: /(^|\.)ams\.org$/i,
    // The DOI lacks the journal and issue folders, so only the landing page gives the PDF.
    landing: {
      path: /^\/(?:journals\/)?([a-z]+)\/(\d{4}-[\d-]+)\/(S[\w()-]+)\/?$/i,
      pdfUrls: (m) => [amsPdf(m[1]!, m[2]!, m[3]!)],
    },
    examples: [
      { from: "https://www.ams.org/journals/bull/1982-07-01/S0273-0979-1982-15004-2/", pdf: amsPdf("bull", "1982-07-01", "S0273-0979-1982-15004-2") },
      { from: "https://pubs.ams.org/BULL/1982-07-01/S0273-0979-1982-15004-2", pdf: amsPdf("bull", "1982-07-01", "S0273-0979-1982-15004-2") },
    ],
  },
  {
    platform: "Annals of Mathematics",
    hosts: /^annals\.math\.princeton\.edu$/i,
    // The DOI does not name the issue or the page slot, so only the landing page gives the PDF.
    landing: {
      path: /^\/\d{4}\/(\d+)-(\d+)\/(p\d+)\/?$/i,
      pdfUrls: (m) => [`https://annals.math.princeton.edu/wp-content/uploads/annals-v${m[1]}-n${m[2]}-${m[3]}.pdf`],
    },
    examples: [{
      from: "https://annals.math.princeton.edu/2004/160-2/p12",
      pdf: "https://annals.math.princeton.edu/wp-content/uploads/annals-v160-n2-p12.pdf",
    }],
  },
  {
    platform: "JSTOR",
    hosts: /(^|\.)jstor\.org$/i,
    // The DOI suffix is the stable id.
    doi: { prefixes: ["10.2307"], pdfUrls: (doi) => [jstorPdf(doi.slice(doi.indexOf("/") + 1))] },
    landing: { path: /^\/stable\/(\d+)(?:[/?]|$)/, pdfUrls: (m) => [jstorPdf(m[1]!)] },
    examples: [
      { from: "10.2307/1914185", pdf: jstorPdf("1914185") },
      { from: "https://www.jstor.org/stable/1914185?origin=crossref", pdf: jstorPdf("1914185") },
    ],
  },
  {
    platform: "bioRxiv and medRxiv",
    openAccess: true,
    hosts: /(^|\.)(biorxiv|medrxiv)\.org$/i,
    // 10.1101 DOIs do not say which server holds the preprint, and a wrong server answers with an error.
    // Without a version the server sends the latest one.
    doi: {
      prefixes: ["10.1101"],
      pdfUrls: (doi) => ["biorxiv", "medrxiv"].map((server) => `https://www.${server}.org/content/${doi}.full.pdf`),
    },
    landing: {
      path: /^\/content\/(10\.1101\/[\d.]+?)(v\d+)?(?:\.full(?:-text)?|\.abstract|\.article-info)?\/?$/i,
      pdfUrls: (m, page) => [`https://${page.host}/content/${m[1]}${m[2] ?? ""}.full.pdf`],
    },
    examples: [
      { from: "10.1101/2020.03.22.002386", pdf: "https://www.biorxiv.org/content/10.1101/2020.03.22.002386.full.pdf" },
      {
        from: "https://www.medrxiv.org/content/10.1101/2020.03.19.20038596v1",
        pdf: "https://www.medrxiv.org/content/10.1101/2020.03.19.20038596v1.full.pdf",
      },
    ],
  },
];
