/** Looks for an identified paper's PDF through the resolver chain and logs what it tried when nothing downloads. */
import type { PdfVersion } from "../../model/index.js";
import type { DetectedIds } from "../identifiers/index.js";
import type { PdfCandidate } from "../landing/index.js";
import type { ResolvedMetadata } from "../metadata/index.js";
import { DEFAULT_CONTACT_EMAIL } from "../registries/index.js";
import { createResolverEnv } from "./env.js";
import { makeResolveContext, type ResolveOptions } from "./resolveContext.js";
import { resolvePdf } from "./resolvePdf.js";
import type { PdfAttempt, PdfFetchOptions, ResolvedPdf } from "./pdfResolver.js";

export interface PdfSearch extends Partial<ResolveOptions> {
  ids: DetectedIds;
  /** PubMed Central id in "PMC1234567" form, when the user typed one. */
  pmcid?: string;
  metadata: ResolvedMetadata;
  landingUrl?: string | undefined;
  pageCandidates?: PdfCandidate[];
  /** The version of the PDF the paper already has; set, only a copy that outranks it is looked for. */
  betterThan?: PdfVersion | undefined;
  /** What the user gave or the page the paper came from, to tell the log lines apart. */
  input: string;
}

/**
 * `attempts` collects every URL tried, so a miss can be explained to the user.
 * @returns the first candidate that downloads as a PDF, or undefined
 */
export async function findPaperPdf(
  fetchOptions: PdfFetchOptions,
  search: PdfSearch,
  attempts: PdfAttempt[] = [],
): Promise<ResolvedPdf | undefined> {
  const context = {
    ...makeResolveContext(search.ids, search.metadata, search.landingUrl, search.pageCandidates ?? [], {
      contactEmail: search.contactEmail ?? DEFAULT_CONTACT_EMAIL,
      customResolvers: search.customResolvers,
    }),
    ...(search.pmcid ? { pmcid: search.pmcid } : {}),
    ...(search.betterThan ? { betterThan: search.betterThan } : {}),
  };
  const found = await resolvePdf(context, fetchOptions, attempts);
  const { logger } = createResolverEnv(fetchOptions);
  if (found) {
    await logger.log("INFO", "pdfFinding", "PDF found", { input: search.input, source: found.source, version: found.version, url: found.url, bytes: found.bytes.length });
  } else {
    await logger.log("INFO", "pdfFinding", "No PDF found", { input: search.input, attempts: attempts.map((a) => `${a.source}: ${a.url}`) });
  }
  return found;
}
