/** Builds the PDF finder's context from what is known about a paper, so the mapping exists once. */
import type { DetectedIds } from "../identifiers/index.js";
import { arxivIdFromDoi } from "../identifiers/index.js";
import type { PdfCandidate } from "../landing/index.js";
import type { ResolvedMetadata } from "../metadata/index.js";
import type { ResolveContext } from "./types.js";

export interface ResolveOptions {
  contactEmail: string;
  /** Sci-Hub mirror base URL; passing it is the user's opt-in. */
  sciHubMirror?: string | undefined;
}

export function makeResolveContext(
  ids: DetectedIds,
  metadata: ResolvedMetadata,
  landingUrl: string | undefined,
  pageCandidates: PdfCandidate[],
  options: ResolveOptions,
): ResolveContext {
  const doi = ids.doi ?? metadata.doi;
  const arxivId = ids.arxivId ?? arxivIdFromDoi(doi);
  return {
    pageCandidates,
    contactEmail: options.contactEmail,
    ...(options.sciHubMirror ? { sciHubMirror: options.sciHubMirror } : {}),
    ...(landingUrl ? { landingUrl } : {}),
    ...(doi ? { doi } : {}),
    ...(arxivId ? { arxivId } : {}),
    ...(ids.pmid ? { pmid: ids.pmid } : {}),
    ...(metadata.title ? { title: metadata.title } : {}),
    ...(metadata.authors?.length ? { authors: metadata.authors } : {}),
    ...(metadata.year !== undefined ? { year: metadata.year } : {}),
  };
}
