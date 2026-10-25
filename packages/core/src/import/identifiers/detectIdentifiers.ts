// Finds DOI, arXiv, PubMed, PMC and ISBN identifiers in a PDF's metadata, link annotations and text.
import { parseString } from "../metadata/index.js";
import { ARXIV_ID_SOURCE } from "./arxiv.js";
import { normalizeDoiCandidate, decodeUrlEscapes } from "./doi.js";
import type { DetectedIdentifier, IdentifierType } from "./detectedIdentifier.js";

// TRAP: returns ranked candidates, not one guess; OCR or damaged-font text holds near-misses only an online lookup can tell apart.

// A whitelist, not a "not whitespace" scan: PDF text runs a DOI into the next
// word, and the SICI form (`10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-O`)
// needs `<>:;()` to stay whole.
const DOI_PATTERN = /10\.\d{4,9}\/[-._;()/:a-z0-9<>+]+/gi;
const ARXIV_PATTERN = new RegExp(String.raw`arxiv[.:\s/]*(?:org\/(?:abs|pdf)\/)?(${ARXIV_ID_SOURCE})(?:v\d+)?`, "gi");
const PMID_PATTERN = /\bPMID[:\s]*(\d{7,8})\b/gi;
const PMCID_PATTERN = /\b(PMC\d{6,8})\b/gi;
const ISBN_PATTERN = /\bISBN(?:-1[03])?[:\s]*((?:97[89][-\s]?)?(?:\d[-\s]?){9}[\dXx])\b/gi;

const PRIORITY: Record<IdentifierType, number> = { doi: 0, arxiv: 1, pmid: 2, pmcid: 3, isbn: 4 };

/**
 * Collects all identifiers present in a PDF, most trustworthy first.
 * @returns Ranked, deduplicated identifier candidates.
 */
export function detectIdentifiers(
  pdfInfo: Record<string, unknown>,
  text: string,
  linkUrls: string[] = [],
): DetectedIdentifier[] {
  const found: DetectedIdentifier[] = [];
  const seen = new Set<string>();

  const add = (type: IdentifierType, value: string | undefined): void => {
    if (!value) {
      return;
    }
    const key = `${type}:${value.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      found.push({ type, value });
    }
  };

  // Ranked by how directly the source states the identifier: an explicit
  // metadata field, then a link target, then anything spotted in the text.
  const metaText = [
    parseString(pdfInfo["DOI"]),
    parseString(pdfInfo["Subject"]),
    parseString(pdfInfo["Keywords"]),
    parseString(pdfInfo["WPS-ARTICLEDOI"]),
  ]
    .filter(Boolean)
    .join(" ");
  const urlText = linkUrls.join(" ");

  for (const source of [decodeUrlEscapes(metaText), decodeUrlEscapes(urlText), text]) {
    if (source) {
      scanSource(source, add);
    }
  }

  // Text extraction can split a DOI across items ("10.1038/ nature12373").
  if (!found.some((entry) => entry.type === "doi")) {
    const glued = text.replace(/(10\.\d{4,9}\s*\/)\s*/gi, (_m, prefix: string) => prefix.replace(/\s+/g, ""));
    for (const doi of matchAll(glued, DOI_PATTERN)) {
      add("doi", normalizeDoiCandidate(doi));
    }
  }

  return rank(found, text);
}

function scanSource(source: string, add: (type: IdentifierType, value: string | undefined) => void): void {
  for (const doi of matchAll(source, DOI_PATTERN)) {
    add("doi", normalizeDoiCandidate(doi));
  }
  for (const arxiv of matchAll(source, ARXIV_PATTERN, 1)) {
    add("arxiv", arxiv);
  }
  for (const pmid of matchAll(source, PMID_PATTERN, 1)) {
    add("pmid", pmid);
  }
  for (const pmcid of matchAll(source, PMCID_PATTERN, 1)) {
    add("pmcid", pmcid.toUpperCase());
  }
  for (const isbn of matchAll(source, ISBN_PATTERN, 1)) {
    add("isbn", isbn.replace(/[-\s]/g, ""));
  }
}

// Identifiers stated next to an explicit label are far more likely to belong to
// this paper than one scraped out of the bibliography.
function rank(found: DetectedIdentifier[], text: string): DetectedIdentifier[] {
  return [...found].sort((a, b) => {
    const labelled = Number(isLabelled(b, text)) - Number(isLabelled(a, text));
    return labelled !== 0 ? labelled : PRIORITY[a.type] - PRIORITY[b.type];
  });
}

function isLabelled(identifier: DetectedIdentifier, text: string): boolean {
  const index = text.indexOf(identifier.value);
  if (index < 0) {
    return false;
  }
  return /\b(doi|doi\.org|arxiv|pmid|pmc|isbn|cite this|citation)\b[\s:/]*$/i.test(
    text.slice(Math.max(0, index - 24), index),
  );
}

function matchAll(text: string, pattern: RegExp, group = 0): string[] {
  // Fresh regex per call: the module-level patterns are global and stateful.
  const local = new RegExp(pattern.source, pattern.flags);
  return [...text.matchAll(local)].map((match) => match[group] ?? "").filter(Boolean);
}
