/** Runs the core PDF chain for a paper an import identified, and logs what it tried when nothing downloads. */
import type { DetectedIds } from "../identifiers/index.js";
import type { PdfCandidate } from "../landing/index.js";
import type { ResolvedMetadata } from "../metadata/index.js";
import { DEFAULT_CONTACT_EMAIL, makeResolveContext, resolvePdf, type PdfAttempt } from "../pdfFinding/index.js";
import { NETWORK_IMPORT_MODULE, pdfFetchOptions, type NetworkImportEnv } from "./env.js";

export interface PdfSearch {
  ids: DetectedIds;
  /** PubMed Central id in "PMC1234567" form, when the user typed one. */
  pmcid?: string;
  metadata: ResolvedMetadata;
  landingUrl?: string;
  pageCandidates?: PdfCandidate[];
  /** What the user gave, to tell the log lines apart. */
  input: string;
}

/**
 * Sci-Hub stays off: it is the user's opt-in, and no setting offers it here yet.
 * @returns the PDF's bytes, or undefined when no resolver's candidate downloads as a PDF
 */
export async function findPdf(env: NetworkImportEnv, search: PdfSearch): Promise<Uint8Array | undefined> {
  const context = {
    ...makeResolveContext(search.ids, search.metadata, search.landingUrl, search.pageCandidates ?? [], { contactEmail: DEFAULT_CONTACT_EMAIL }),
    ...(search.pmcid ? { pmcid: search.pmcid } : {}),
  };
  const attempts: PdfAttempt[] = [];
  const found = await resolvePdf(context, pdfFetchOptions(env), attempts);
  const summary = attempts.map((attempt) => `${attempt.source}: ${attempt.url}`);
  if (found) {
    await env.ctx.logger.log("INFO", NETWORK_IMPORT_MODULE, "PDF found", { input: search.input, source: found.source, url: found.url });
    return found.bytes;
  }
  await env.ctx.logger.log("INFO", NETWORK_IMPORT_MODULE, "No PDF found; saving the reference only", { input: search.input, attempts: summary });
  return undefined;
}
