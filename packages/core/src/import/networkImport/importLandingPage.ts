/** Imports a paper from the landing page of an article: reads its citation tags, resolves the record, finds the PDF. */
import type { ImportOutcome } from "../../library/index.js";
import { interpretPage, parseHtmlPage } from "../landing/index.js";
import { findInLibrary, PAGE_TRUST, resolveMetadata } from "../resolution/index.js";
import type { Downloaded } from "./downloads.js";
import { NETWORK_IMPORT_MODULE, type NetworkImportEnv } from "./env.js";
import { findPdf } from "./findPdf.js";
import { writeImportedPaper } from "./writeImportedPaper.js";

const MAX_HTML_BYTES = 5 * 1024 * 1024;

/**
 * Saves the paper a landing page describes with the PDF the core chain finds for it, or as a reference without a PDF
 * when none downloads.
 * @returns what happened
 */
export async function importLandingPage(
  env: NetworkImportEnv,
  page: Downloaded,
  input: string,
  targetDir: string,
): Promise<ImportOutcome> {
  const { ctx } = env;
  const facts = interpretPage(parseHtmlPage(new TextDecoder().decode(page.bytes.slice(0, MAX_HTML_BYTES)), page.finalUrl));
  if (!facts.isPaper) {
    await ctx.logger.log("WARN", NETWORK_IMPORT_MODULE, "Landing page describes no paper", { input, finalUrl: page.finalUrl });
    return { status: "failed", error: "No paper found on the page", input };
  }

  const resolved = await resolveMetadata(
    { ids: facts.ids, sources: [{ name: "page", trust: facts.structured ? PAGE_TRUST.structured : PAGE_TRUST.titleOnly, metadata: facts.metadata }] },
    {
      ...(env.resolveIdentifier ? { resolveIdentifier: env.resolveIdentifier } : {}),
      ...(env.searchByTitle ? { searchByTitle: env.searchByTitle } : {}),
    },
  );
  if (!resolved.metadata.title) {
    await ctx.logger.log("WARN", NETWORK_IMPORT_MODULE, "Landing page has no title", { input, finalUrl: page.finalUrl });
    return { status: "failed", error: "No paper found on the page", input };
  }

  const existing = findInLibrary(env.records(), { ...resolved.ids, title: resolved.metadata.title, year: resolved.metadata.year });
  if (existing) { return { status: "duplicate", existingId: existing.id, input }; }

  const pdf = await findPdf(env, {
    ids: resolved.ids,
    metadata: resolved.metadata,
    landingUrl: page.finalUrl,
    pageCandidates: facts.pdfCandidates,
    input,
  });
  const record = await writeImportedPaper(ctx, env.importDeps(), targetDir, {
    metadata: resolved.metadata,
    pdf,
    extra: { ...(resolved.ids.doi && !resolved.metadata.doi ? { doi: resolved.ids.doi } : {}) },
    log: { message: "Paper imported from landing page", context: { url: page.finalUrl, origin: resolved.origin } },
  });
  return { status: "added", record, needsReview: false, input };
}
