/**
 * Turns one Google Scholar result (its "Save to LabShelf" button) into a capture
 * draft. Scholar shows only a title, an abbreviated author line and links, so
 * the paper is identified the way a person would: the DOI inside the result's
 * links, else the article's landing page (fetched in the background and read
 * for its citation tags), else a registry search by title that must agree
 * with the year and authors Scholar printed. The "[PDF]" link Scholar found
 * is the first PDF candidate; the usual resolver chain follows it.
 */
import { arxivIdFromUrl, extractDoi, pmidFromUrl } from "@labshelf/core";
import type { DetectedIds, MetadataSource, PageFacts, PdfCandidate, ResolvedMetadata } from "@labshelf/core";
import { draftFromFacts } from "./captureService";
import type { CaptureDraft } from "./captureService";
import { landingFacts } from "./landingFacts";
import type { ScholarHit } from "../platform/runtimeMessages";

// Scholar's own line is abbreviated ("OH Ibarra", "Proceedings of the …"), so
// it only fills what nothing better states.
const SCHOLAR_TRUST = 20;

/**
 * Identifiers a result's links reveal (publisher URLs embed the DOI).
 * @usedBy draftFromScholarHit, tests
 */
export function idsFromHit(hit: ScholarHit): DetectedIds {
  const urls = [hit.url, hit.pdfUrl].filter((u): u is string => !!u);
  const doi = urls.map((u) => extractDoi(u)).find(Boolean);
  const arxivId = urls.map(arxivIdFromUrl).find(Boolean);
  const pmid = urls.map(pmidFromUrl).find(Boolean);
  return { ...(doi ? { doi } : {}), ...(arxivId ? { arxivId } : {}), ...(pmid ? { pmid } : {}) };
}

/**
 * What Scholar itself printed, as a low-trust metadata source.
 * @usedBy draftFromScholarHit, tests
 */
export function metadataFromHit(hit: ScholarHit): ResolvedMetadata {
  const meta: ResolvedMetadata = { title: hit.title };
  if (hit.authors.length) meta.authors = hit.authors;
  if (hit.year) meta.year = hit.year;
  if (hit.venue && !hit.venue.includes("…")) meta.journal = hit.venue;
  if (hit.url) meta.url = hit.url;
  return meta;
}

/**
 * Builds the draft for a Scholar result.
 * @usedBy background/index (scholar.save)
 */
export async function draftFromScholarHit(hit: ScholarHit): Promise<CaptureDraft> {
  const ids = idsFromHit(hit);
  const landing = !ids.doi && !ids.arxivId && hit.url ? await landingFacts(hit.url) : undefined;

  const scholarPdf: PdfCandidate[] = hit.pdfUrl ? [{ url: hit.pdfUrl, source: "scholar" }] : [];
  const facts: PageFacts = landing
    ? { ...landing, ids: { ...ids, ...landing.ids }, isPaper: true, pdfCandidates: [...scholarPdf, ...landing.pdfCandidates] }
    : { pageUrl: hit.url ?? hit.pdfUrl ?? "", ids, metadata: {}, structured: false, pdfCandidates: scholarPdf, isPaper: true };

  const scholarSource: MetadataSource = { name: "scholar", trust: SCHOLAR_TRUST, metadata: metadataFromHit(hit) };
  return draftFromFacts(facts, {}, [scholarSource]);
}
