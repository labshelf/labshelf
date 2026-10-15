// Turns one Google Scholar result into a capture draft: DOI in its links, else landing page, else title search.
// A title match must agree with the year and authors Scholar printed; Scholar's "[PDF]" link is the first candidate.
import { arxivIdFromUrl, extractDoi, pmidFromUrl } from "@labshelf/core";
import type { DetectedIds, ILogger, MetadataSource, PageFacts, PdfCandidate, ResolvedMetadata } from "@labshelf/core";
import { draftFromFacts } from "./captureService";
import type { CaptureDraft } from "./captureService";
import { landingFacts } from "./landingFacts";
import type { ScholarHit } from "../platform";

// Scholar's own line is abbreviated ("OH Ibarra", "Proceedings of the …"), so
// it only fills what nothing better states.
const SCHOLAR_TRUST = 20;

/**
 * Identifiers a result's links reveal (publisher URLs embed the DOI).
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
 */
export async function draftFromScholarHit(log: ILogger, hit: ScholarHit): Promise<CaptureDraft> {
  const ids = idsFromHit(hit);
  const landing = !ids.doi && !ids.arxivId && hit.url ? await landingFacts(log, hit.url) : undefined;

  const scholarPdf: PdfCandidate[] = hit.pdfUrl ? [{ url: hit.pdfUrl, source: "scholar" }] : [];
  const facts: PageFacts = landing
    ? { ...landing, ids: { ...ids, ...landing.ids }, isPaper: true, pdfCandidates: [...scholarPdf, ...landing.pdfCandidates] }
    : { pageUrl: hit.url ?? hit.pdfUrl ?? "", ids, metadata: {}, structured: false, pdfCandidates: scholarPdf, isPaper: true };

  const scholarSource: MetadataSource = { name: "scholar", trust: SCHOLAR_TRUST, metadata: metadataFromHit(hit) };
  return draftFromFacts(log, facts, {}, [scholarSource]);
}
