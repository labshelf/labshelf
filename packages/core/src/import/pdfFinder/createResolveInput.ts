/** Builds the PDF finder's context from what is known about a paper, so the mapping exists once. */
import type { DetectedIds } from "../identifiers/index.js";
import { extractArxivIdentifierFromDoi } from "../identifiers/index.js";
import type { PdfCandidate } from "../landing/index.js";
import type { ResolvedMetadata } from "../metadata/index.js";
import type { CustomResolver, ResolveContext } from "./pdfResolver.js";

export interface ResolveOptions {
  contactEmail: string;
  /** Passing any is the user's opt-in; without them no custom host is contacted. */
  customResolvers?: readonly CustomResolver[] | undefined;
}

export function createResolveInput(
  ids: DetectedIds,
  metadata: ResolvedMetadata,
  landingUrl: string | undefined,
  pageCandidates: PdfCandidate[],
  options: ResolveOptions,
): ResolveContext {
  const doi = ids.doi ?? metadata.doi;
  const arxivId = ids.arxivId ?? extractArxivIdentifierFromDoi(doi);
  return {
    pageCandidates,
    contactEmail: options.contactEmail,
    ...(options.customResolvers?.length ? { customResolvers: options.customResolvers } : {}),
    ...(landingUrl ? { landingUrl } : {}),
    ...(doi ? { doi } : {}),
    ...(arxivId ? { arxivId } : {}),
    ...(ids.pmid ? { pmid: ids.pmid } : {}),
    ...(metadata.title ? { title: metadata.title } : {}),
    ...(metadata.authors?.length ? { authors: metadata.authors } : {}),
    ...(metadata.year !== undefined ? { year: metadata.year } : {}),
  };
}
