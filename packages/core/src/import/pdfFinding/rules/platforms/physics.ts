/** Rules for the physics societies' platforms (IOP, APS, AIP). */
import type { PublisherRule } from "../publisherRule.js";

const apsPdf = (doi: string): string => `https://link.aps.org/pdf/${doi}`;

export const PHYSICS_RULES: PublisherRule[] = [
  {
    platform: "IOPscience",
    hosts: /^iopscience\.iop\.org$/i,
    doi: { prefixes: ["10.1088"], pdfUrls: (doi) => [`https://iopscience.iop.org/article/${doi}/pdf`] },
    examples: [{ from: "10.1088/0953-8984/21/39/395502", pdf: "https://iopscience.iop.org/article/10.1088/0953-8984/21/39/395502/pdf" }],
  },
  {
    platform: "APS",
    hosts: /(^|\.)aps\.org$/i,
    // link.aps.org resolves the journal from the DOI, so the URL needs no journal abbreviation.
    doi: { prefixes: ["10.1103"], pdfUrls: (doi) => [apsPdf(doi)] },
    landing: {
      path: /^\/([a-z]+)\/(?:abstract|references|cited-by|supplemental)\/(10\.\d{4,9}\/[^?#]+)/i,
      pdfUrls: (m) => [`https://journals.aps.org/${m[1]}/pdf/${m[2]}`],
    },
    examples: [
      { from: "10.1103/PhysRevLett.116.061102", pdf: apsPdf("10.1103/PhysRevLett.116.061102") },
      {
        from: "https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.116.061102",
        pdf: "https://journals.aps.org/prl/pdf/10.1103/PhysRevLett.116.061102",
      },
    ],
  },
  {
    platform: "AIP Publishing",
    hosts: /^pubs\.aip\.org$/i,
    // Its article pages carry opaque ids, so only the DOI form is derivable; a paywalled one answers with the abstract page.
    doi: { prefixes: ["10.1063"], pdfUrls: (doi) => [`https://pubs.aip.org/doi/pdf/${doi}`] },
    examples: [{ from: "10.1063/1.464913", pdf: "https://pubs.aip.org/doi/pdf/10.1063/1.464913" }],
  },
];
