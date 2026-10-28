/** The publisher rule table: every platform family's rules in one list, one named section per family. */
import type { PublisherRule } from "./rules.js";

// Builds rules for platforms whose pages and PDFs both sit under /doi/<doi> on the same host (Atypon, Wiley).
// The landing views carry the DOI after /doi/ or /doi/<view>/; "pdf" and "pdfdirect" are not views, so a PDF URL never matches.
const DOI_LANDING = /^\/doi\/(?:(?:abs|full|epdf|epub|reader|book)\/)?(10\.\d{4,9}\/[^?#]+)/i;

interface DoiPathPlatform {
  platform: string;
  /** Canonical host for PDFs built from a bare DOI. */
  host: string;
  /** Hosts that serve the platform's pages; defaults to `host` alone. */
  hosts?: RegExp;
  prefixes: readonly string[];
  /** A real DOI on the platform; its landing example is the DOI's /doi/abs/ page on `host`. */
  example: string;
  /** Path segment before the DOI in the PDF URL, "pdf" unless the platform needs another. */
  pdfPath?: string;
  /** Query the PDF URL needs ("?download=true" on some sites). */
  query?: string;
}

function createDoiPathRule(p: DoiPathPlatform): PublisherRule {
  const pdfAt = (host: string, doi: string): string => `https://${host}/doi/${p.pdfPath ?? "pdf"}/${doi}${p.query ?? ""}`;
  return {
    platform: p.platform,
    hosts: p.hosts ?? new RegExp(`^${p.host.replace(/\./g, "\\.")}$`, "i"),
    doi: { prefixes: p.prefixes, pdfUrls: (doi) => [pdfAt(p.host, doi)] },
    landing: { path: DOI_LANDING, pdfUrls: (m, page) => [pdfAt(page.host, decodeURIComponent(m[1]!))] },
    examples: [
      { from: p.example, pdf: pdfAt(p.host, p.example) },
      { from: `https://${p.host}/doi/abs/${p.example}`, pdf: pdfAt(p.host, p.example) },
    ],
  };
}

// Rules for journals hosted on Atypon's Literatum, which serves PDFs at /doi/pdf/<doi>.
const ATYPON_RULES: PublisherRule[] = [
  createDoiPathRule({ platform: "ACM", host: "dl.acm.org", prefixes: ["10.1145"], example: "10.1145/3065386" }),
  createDoiPathRule({ platform: "SIAM", host: "epubs.siam.org", prefixes: ["10.1137"], example: "10.1137/S0036144598347011" }),
  createDoiPathRule({ platform: "Taylor & Francis", host: "www.tandfonline.com", prefixes: ["10.1080"], example: "10.1080/01621459.1958.10501452" }),
  createDoiPathRule({ platform: "SAGE", host: "journals.sagepub.com", prefixes: ["10.1177", "10.1089"], example: "10.1177/0956797611417632" }),
  createDoiPathRule({ platform: "PNAS", host: "www.pnas.org", hosts: /(^|\.)pnas\.org$/i, prefixes: ["10.1073"], example: "10.1073/pnas.79.8.2554" }),
  createDoiPathRule({ platform: "Science", host: "www.science.org", prefixes: ["10.1126"], example: "10.1126/science.aac4716" }),
  createDoiPathRule({ platform: "ACS", host: "pubs.acs.org", prefixes: ["10.1021"], example: "10.1021/ja809598r" }),
  createDoiPathRule({ platform: "Annual Reviews", host: "www.annualreviews.org", prefixes: ["10.1146"], example: "10.1146/annurev.neuro.24.1.167" }),
  createDoiPathRule({ platform: "INFORMS", host: "pubsonline.informs.org", prefixes: ["10.1287"], example: "10.1287/mnsc.35.8.982" }),
  createDoiPathRule({ platform: "NEJM", host: "www.nejm.org", prefixes: ["10.1056"], example: "10.1056/NEJMoa2034577" }),
  createDoiPathRule({ platform: "AIAA", host: "arc.aiaa.org", prefixes: ["10.2514"], example: "10.2514/3.20031" }),
  createDoiPathRule({ platform: "ASCE", host: "ascelibrary.org", prefixes: ["10.1061"], example: "10.1061/(ASCE)0733-9445(2008)134:1(1)" }),
  createDoiPathRule({ platform: "ASM", host: "journals.asm.org", prefixes: ["10.1128"], example: "10.1128/mr.59.1.143-169.1995", query: "?download=true" }),
  createDoiPathRule({ platform: "World Scientific", host: "www.worldscientific.com", prefixes: ["10.1142"], example: "10.1142/S0129054101000540", query: "?download=true" }),
  createDoiPathRule({ platform: "AHA Journals", host: "www.ahajournals.org", prefixes: ["10.1161"], example: "10.1161/CIR.0000000000000485" }),
  // The physiology.org apex and www redirect to journals.physiology.org.
  createDoiPathRule({ platform: "American Physiological Society", host: "journals.physiology.org", hosts: /(^|\.)physiology\.org$/i, prefixes: ["10.1152"], example: "10.1152/jn.00001.2020" }),
  createDoiPathRule({ platform: "Psychiatry Online", host: "psychiatryonline.org", prefixes: ["10.1176"], example: "10.1176/ajp.156.1.1" }),
  createDoiPathRule({ platform: "ASHA", host: "pubs.asha.org", prefixes: ["10.1044"], example: "10.1044/jshr.2504.628" }),
  createDoiPathRule({ platform: "University of Chicago Press", host: "www.journals.uchicago.edu", hosts: /(^|\.)journals\.uchicago\.edu$/i, prefixes: ["10.1086"], example: "10.1086/723495" }),
  createDoiPathRule({ platform: "ASCO", host: "ascopubs.org", prefixes: ["10.1200"], example: "10.1200/JCO.1986.4.6.906" }),
  createDoiPathRule({ platform: "Canadian Science Publishing", host: "cdnsciencepub.com", prefixes: ["10.1139"], example: "10.1139/v82-208" }),
  createDoiPathRule({ platform: "Hogrefe", host: "econtent.hogrefe.com", prefixes: ["10.1027"], example: "10.1027/1015-5759.12.3.175" }),
];

// Rules for Wiley Online Library and the society journals it hosts, which serve PDFs at /doi/pdfdirect/<doi>.
const WILEY_RULES: PublisherRule[] = [
  createDoiPathRule({
    platform: "Wiley",
    host: "onlinelibrary.wiley.com",
    // Society journals live on their own subdomain of the same platform.
    hosts: /(^|\.)onlinelibrary\.wiley\.com$/i,
    // 10.1002/10.1111 are Wiley's own; the rest are societies hosted on a subdomain (AGU, Physiological Society, NYAS, ACSESS, ASLO) or on the main host (MJA, Traffic and other Blackwell-era journals).
    prefixes: ["10.1002", "10.1111", "10.1029", "10.1113", "10.1034", "10.1196", "10.2135", "10.2136", "10.4319", "10.5694"],
    pdfPath: "pdfdirect",
    example: "10.1002/jcc.20035",
  }),
];

// Rules for Springer Nature's SpringerLink and nature.com, which key PDFs by the DOI or the article id.
const springerPdf = (doi: string): string => `https://link.springer.com/content/pdf/${doi}.pdf`;
const naturePdf = (id: string): string => `https://www.nature.com/articles/${id}.pdf`;

const SPRINGER_NATURE_RULES: PublisherRule[] = [
  {
    platform: "Springer",
    hosts: /^link\.springer\.com$/i,
    // 10.1186 is BioMed Central, 10.1023 Kluwer; SpringerLink serves both.
    doi: { prefixes: ["10.1007", "10.1186", "10.1023"], pdfUrls: (doi) => [springerPdf(doi)] },
    landing: { path: /^\/(?:article|chapter)\/(10\.\d{4,9}\/[^?#]+)/i, pdfUrls: (m) => [springerPdf(decodeURIComponent(m[1]!))] },
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
    landing: { path: /^\/articles\/([^/?#]+?)(?<!\.pdf)\/?(?:[?#]|$)/i, pdfUrls: (m) => [naturePdf(m[1]!)] },
    examples: [
      { from: "10.1038/s41586-020-2649-2", pdf: naturePdf("s41586-020-2649-2") },
      { from: "https://www.nature.com/articles/nbt.1754", pdf: naturePdf("nbt.1754") },
    ],
  },
];

// Rules for commercial publishers' own platforms: Elsevier, IEEE, De Gruyter, Thieme and BMJ.
const sciencePdf = (pii: string): string => `https://www.sciencedirect.com/science/article/pii/${pii}/pdfft?isDTMRedir=true&download=true`;
const degruyterPdf = (doi: string): string => `https://www.degruyterbrill.com/document/doi/${doi}/pdf`;
const thiemePdf = (doi: string): string => `https://www.thieme-connect.com/products/ejournals/pdf/${doi}.pdf`;

const COMMERCIAL_PUBLISHER_RULES: PublisherRule[] = [
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
    landing: { path: /^\/(?:abstract\/)?document\/(\d+)/i, pdfUrls: (m) => [`https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=${m[1]}`] },
    examples: [{ from: "https://ieeexplore.ieee.org/document/726791", pdf: "https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=726791" }],
  },
  {
    platform: "De Gruyter",
    hosts: /(^|\.)(degruyterbrill|degruyter)\.com$/i,
    doi: { prefixes: ["10.1515"], pdfUrls: (doi) => [degruyterPdf(doi)] },
    landing: { path: /^\/document\/doi\/(10\.\d{4,9}\/[^?#]+?)\/html\b/i, pdfUrls: (m) => [degruyterPdf(m[1]!)] },
    examples: [
      { from: "10.1515/jaa-2019-0017", pdf: degruyterPdf("10.1515/jaa-2019-0017") },
      { from: "https://www.degruyterbrill.com/document/doi/10.1515/jaa-2019-0017/html", pdf: degruyterPdf("10.1515/jaa-2019-0017") },
    ],
  },
  {
    platform: "Thieme",
    hosts: /(^|\.)thieme-connect\.(com|de)$/i,
    doi: { prefixes: ["10.1055"], pdfUrls: (doi) => [thiemePdf(doi)] },
    landing: { path: /^\/products\/ejournals\/(?:abstract|html)\/(10\.\d{4,9}\/[^?#]+)/i, pdfUrls: (m) => [thiemePdf(m[1]!)] },
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

// Rules for the physics societies' platforms (IOP, APS, AIP).
const apsPdf = (doi: string): string => `https://link.aps.org/pdf/${doi}`;

const PHYSICS_RULES: PublisherRule[] = [
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
      { from: "https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.116.061102", pdf: "https://journals.aps.org/prl/pdf/10.1103/PhysRevLett.116.061102" },
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

// Rules for fully open-access publishers, whose PDFs need no session.
const elifePdf = (id: string, version: number): string => `https://cdn.elifesciences.org/articles/${id}/elife-${id}-v${version}.pdf`;
const copernicusPdf = (code: string, vol: string, page: string, year: string): string =>
  `https://${code}.copernicus.org/articles/${vol}/${page}/${year}/${code}-${vol}-${page}-${year}.pdf`;
const peerjPdf = (id: string): string => `https://peerj.com/articles/${id}.pdf`;

const OPEN_ACCESS_RULES: PublisherRule[] = [
  {
    platform: "Frontiers",
    openAccess: true,
    hosts: /(^|\.)frontiersin\.org$/i,
    doi: { prefixes: ["10.3389"], pdfUrls: (doi) => [`https://www.frontiersin.org/articles/${doi}/pdf`] },
    examples: [{ from: "10.3389/fpsyg.2013.00863", pdf: "https://www.frontiersin.org/articles/10.3389/fpsyg.2013.00863/pdf" }],
  },
  {
    platform: "PLOS",
    openAccess: true,
    hosts: /^journals\.plos\.org$/i,
    doi: { prefixes: ["10.1371"], pdfUrls: (doi) => [`https://journals.plos.org/plosone/article/file?id=${doi}&type=printable`] },
    examples: [{ from: "10.1371/journal.pmed.0020124", pdf: "https://journals.plos.org/plosone/article/file?id=10.1371/journal.pmed.0020124&type=printable" }],
  },
  {
    platform: "MDPI",
    openAccess: true,
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
    openAccess: true,
    hosts: /(^|\.)elifesciences\.org$/i,
    // The CDN names a PDF by the article's version: revised articles have a v2, and v1 stays.
    doi: {
      prefixes: ["10.7554"],
      pdfUrls: (doi) => {
        const id = /^10\.7554\/eLife\.(\d+)$/i.exec(doi)?.[1];
        return id ? [elifePdf(id, 1), elifePdf(id, 2)] : [];
      },
    },
    landing: { path: /^\/(?:articles|reviewed-preprints)\/(\d+)(?:v\d+)?\/?$/i, pdfUrls: (m) => [elifePdf(m[1]!, 1), elifePdf(m[1]!, 2)] },
    examples: [
      { from: "10.7554/eLife.07083", pdf: elifePdf("07083", 1) },
      { from: "https://elifesciences.org/articles/07083", pdf: elifePdf("07083", 1) },
    ],
  },
  {
    platform: "PeerJ",
    openAccess: true,
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
    openAccess: true,
    hosts: /(^|\.)copernicus\.org$/i,
    // Each journal has its own subdomain, named by the code that opens the DOI suffix.
    doi: {
      prefixes: ["10.5194"],
      pdfUrls: (doi) => {
        const m = /^10\.5194\/([a-z]+)-(\d+)-(\d+)-(\d{4})$/i.exec(doi);
        return m ? [copernicusPdf(m[1]!.toLowerCase(), m[2]!, m[3]!, m[4]!)] : [];
      },
    },
    landing: { path: /^\/articles\/(\d+)\/(\d+)\/(\d{4})\/?$/, pdfUrls: (m, page) => [copernicusPdf(page.hostname.split(".")[0]!, m[1]!, m[2]!, m[3]!)] },
    examples: [
      { from: "10.5194/acp-15-1-2015", pdf: copernicusPdf("acp", "15", "1", "2015") },
      { from: "https://bg.copernicus.org/articles/12/1/2015/", pdf: copernicusPdf("bg", "12", "1", "2015") },
    ],
  },
  {
    platform: "SciELO",
    openAccess: true,
    hosts: /(^|\.)scielo\.(?:[a-z]{2,3}|org\.[a-z]{2})$/i,
    // The DOI does not carry the article id. A PDF URL ("?format=pdf") never counts as a landing page.
    landing: { path: /^\/j\/([^/]+)\/a\/([^/?#]+)\/?(?:\?(?!.*format=pdf).*)?$/i, pdfUrls: (m, page) => [`https://${page.host}/j/${m[1]}/a/${m[2]}/?format=pdf`] },
    examples: [{ from: "https://www.scielo.br/j/mioc/a/XpyZfLm7yZbBckwwqWjWxnz/?lang=en", pdf: "https://www.scielo.br/j/mioc/a/XpyZfLm7yZbBckwwqWjWxnz/?format=pdf" }],
  },
];

// Rules for learned societies, preprint servers and scholarly archives.
const aclPdf = (id: string): string => `https://aclanthology.org/${id}.pdf`;
const aeaPdf = (doi: string): string => `https://www.aeaweb.org/articles/pdf/doi/${doi}`;
const jstorPdf = (id: string): string => `https://www.jstor.org/stable/pdf/${id}.pdf?acceptTC=true`;
const amsPdf = (journal: string, issue: string, pii: string): string =>
  `https://www.ams.org/journals/${journal.toLowerCase()}/${issue}/${pii}/${pii}.pdf`;

const SOCIETY_AND_ARCHIVE_RULES: PublisherRule[] = [
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
    landing: { path: /^(?:\/articles\?id=|\/doi\/(?:abs\/|full\/)?)(10\.\d{4,9}\/[^&?#]+)/i, pdfUrls: (m) => [aeaPdf(decodeURIComponent(m[1]!))] },
    examples: [
      { from: "10.1257/aer.91.5.1369", pdf: aeaPdf("10.1257/aer.91.5.1369") },
      { from: "https://www.aeaweb.org/articles?id=10.1257/aer.91.5.1369", pdf: aeaPdf("10.1257/aer.91.5.1369") },
    ],
  },
  {
    platform: "AMS",
    hosts: /(^|\.)ams\.org$/i,
    // The DOI lacks the journal and issue folders, so only the landing page gives the PDF.
    landing: { path: /^\/(?:journals\/)?([a-z]+)\/(\d{4}-[\d-]+)\/(S[\w()-]+)\/?$/i, pdfUrls: (m) => [amsPdf(m[1]!, m[2]!, m[3]!)] },
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
    examples: [{ from: "https://annals.math.princeton.edu/2004/160-2/p12", pdf: "https://annals.math.princeton.edu/wp-content/uploads/annals-v160-n2-p12.pdf" }],
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
    doi: { prefixes: ["10.1101"], pdfUrls: (doi) => ["biorxiv", "medrxiv"].map((server) => `https://www.${server}.org/content/${doi}.full.pdf`) },
    landing: {
      path: /^\/content\/(10\.1101\/[\d.]+?)(v\d+)?(?:\.full(?:-text)?|\.abstract|\.article-info)?\/?$/i,
      pdfUrls: (m, page) => [`https://${page.host}/content/${m[1]}${m[2] ?? ""}.full.pdf`],
    },
    examples: [
      { from: "10.1101/2020.03.22.002386", pdf: "https://www.biorxiv.org/content/10.1101/2020.03.22.002386.full.pdf" },
      { from: "https://www.medrxiv.org/content/10.1101/2020.03.19.20038596v1", pdf: "https://www.medrxiv.org/content/10.1101/2020.03.19.20038596v1.full.pdf" },
    ],
  },
];

export const PUBLISHER_RULES: readonly PublisherRule[] = [
  ...ATYPON_RULES,
  ...WILEY_RULES,
  ...SPRINGER_NATURE_RULES,
  ...COMMERCIAL_PUBLISHER_RULES,
  ...PHYSICS_RULES,
  ...OPEN_ACCESS_RULES,
  ...SOCIETY_AND_ARCHIVE_RULES,
];
