/** Rules for fully open-access publishers, whose PDFs need no session. */
import type { PublisherRule } from "../publisherRule.js";

const elifePdf = (id: string, version: number): string => `https://cdn.elifesciences.org/articles/${id}/elife-${id}-v${version}.pdf`;
const copernicusPdf = (code: string, vol: string, page: string, year: string): string =>
  `https://${code}.copernicus.org/articles/${vol}/${page}/${year}/${code}-${vol}-${page}-${year}.pdf`;
const peerjPdf = (id: string): string => `https://peerj.com/articles/${id}.pdf`;

export const OPEN_ACCESS_RULES: PublisherRule[] = [
  {
    platform: "Frontiers",
    hosts: /(^|\.)frontiersin\.org$/i,
    doi: { prefixes: ["10.3389"], pdfUrls: (doi) => [`https://www.frontiersin.org/articles/${doi}/pdf`] },
    examples: [{ from: "10.3389/fpsyg.2013.00863", pdf: "https://www.frontiersin.org/articles/10.3389/fpsyg.2013.00863/pdf" }],
  },
  {
    platform: "PLOS",
    hosts: /^journals\.plos\.org$/i,
    doi: { prefixes: ["10.1371"], pdfUrls: (doi) => [`https://journals.plos.org/plosone/article/file?id=${doi}&type=printable`] },
    examples: [{
      from: "10.1371/journal.pmed.0020124",
      pdf: "https://journals.plos.org/plosone/article/file?id=10.1371/journal.pmed.0020124&type=printable",
    }],
  },
  {
    platform: "MDPI",
    hosts: /(^|\.)mdpi\.com$/i,
    // The DOI does not carry the journal's ISSN, so only the landing page gives the PDF.
    landing: {
      path: /^\/(\d{4}-\d{3}[\dX])\/(\d+)\/(\d+)\/(\d+)(?:\/htm)?\/?(?:\?.*)?$/i,
      pdfUrls: (m) => [`https://www.mdpi.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}/pdf`],
    },
    examples: [{ from: "https://www.mdpi.com/1422-0067/20/1/1", pdf: "https://www.mdpi.com/1422-0067/20/1/1/pdf" }],
  },
  {
    platform: "eLife",
    hosts: /(^|\.)elifesciences\.org$/i,
    // The CDN names a PDF by the article's version: revised articles have a v2, and v1 stays.
    doi: {
      prefixes: ["10.7554"],
      pdfUrls: (doi) => {
        const id = /^10\.7554\/eLife\.(\d+)$/i.exec(doi)?.[1];
        return id ? [elifePdf(id, 1), elifePdf(id, 2)] : [];
      },
    },
    landing: {
      path: /^\/(?:articles|reviewed-preprints)\/(\d+)(?:v\d+)?\/?$/i,
      pdfUrls: (m) => [elifePdf(m[1]!, 1), elifePdf(m[1]!, 2)],
    },
    examples: [
      { from: "10.7554/eLife.07083", pdf: elifePdf("07083", 1) },
      { from: "https://elifesciences.org/articles/07083", pdf: elifePdf("07083", 1) },
    ],
  },
  {
    platform: "PeerJ",
    hosts: /(^|\.)peerj\.com$/i,
    // "peerj.4375" is article 4375; "peerj-cs.55" is article cs-55.
    doi: {
      prefixes: ["10.7717"],
      pdfUrls: (doi) => {
        const m = /^10\.7717\/peerj(?:-([a-z]+))?\.(\d+)$/i.exec(doi);
        return m ? [peerjPdf(m[1] ? `${m[1]}-${m[2]}` : m[2]!)] : [];
      },
    },
    landing: { path: /^\/articles\/((?:[a-z]+-)?\d+)\/?$/i, pdfUrls: (m) => [peerjPdf(m[1]!)] },
    examples: [
      { from: "10.7717/peerj.4375", pdf: peerjPdf("4375") },
      { from: "10.7717/peerj-cs.55", pdf: peerjPdf("cs-55") },
      { from: "https://peerj.com/articles/cs-55/", pdf: peerjPdf("cs-55") },
    ],
  },
  {
    platform: "Copernicus",
    hosts: /(^|\.)copernicus\.org$/i,
    // Each journal has its own subdomain, named by the code that opens the DOI suffix.
    doi: {
      prefixes: ["10.5194"],
      pdfUrls: (doi) => {
        const m = /^10\.5194\/([a-z]+)-(\d+)-(\d+)-(\d{4})$/i.exec(doi);
        return m ? [copernicusPdf(m[1]!.toLowerCase(), m[2]!, m[3]!, m[4]!)] : [];
      },
    },
    landing: {
      path: /^\/articles\/(\d+)\/(\d+)\/(\d{4})\/?$/,
      pdfUrls: (m, page) => [copernicusPdf(page.hostname.split(".")[0]!, m[1]!, m[2]!, m[3]!)],
    },
    examples: [
      { from: "10.5194/acp-15-1-2015", pdf: copernicusPdf("acp", "15", "1", "2015") },
      { from: "https://bg.copernicus.org/articles/12/1/2015/", pdf: copernicusPdf("bg", "12", "1", "2015") },
    ],
  },
  {
    platform: "SciELO",
    hosts: /(^|\.)scielo\.(?:[a-z]{2,3}|org\.[a-z]{2})$/i,
    // The DOI does not carry the article id. A PDF URL ("?format=pdf") never counts as a landing page.
    landing: {
      path: /^\/j\/([^/]+)\/a\/([^/?#]+)\/?(?:\?(?!.*format=pdf).*)?$/i,
      pdfUrls: (m, page) => [`https://${page.host}/j/${m[1]}/a/${m[2]}/?format=pdf`],
    },
    examples: [{
      from: "https://www.scielo.br/j/mioc/a/XpyZfLm7yZbBckwwqWjWxnz/?lang=en",
      pdf: "https://www.scielo.br/j/mioc/a/XpyZfLm7yZbBckwwqWjWxnz/?format=pdf",
    }],
  },
];
