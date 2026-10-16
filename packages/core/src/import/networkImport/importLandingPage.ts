/** Imports a paper from the landing page of an article: reads its citation tags, resolves the record, finds the PDF. */
import type { ImportOutcome } from "../../library/index.js";
import { interpretPage, parseHtmlPage } from "../landing/index.js";
import { normalizeTitle } from "../pdf/index.js";
import { findPaperPdf } from "../pdfFinding/index.js";
import { resolvePagePaper } from "../resolution/index.js";
import type { Downloaded } from "./downloads.js";
import { NETWORK_IMPORT_MODULE, pdfFetchOptions, registryEnv, type NetworkImportEnv } from "./env.js";
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
  const paper = await resolvePagePaper(facts, () => env.records(), {
    deps: {
      registry: registryEnv(env),
      ...(env.resolveIdentifier ? { resolveIdentifier: env.resolveIdentifier } : {}),
      ...(env.searchByTitle ? { searchByTitle: env.searchByTitle } : {}),
    },
  });
  const title = paper.metadata.title;
  if (!paper.isPaper || !title) {
    const message = paper.isPaper ? "Landing page has no title" : "Landing page describes no paper";
    await ctx.logger.log("WARN", NETWORK_IMPORT_MODULE, message, { input, finalUrl: page.finalUrl });
    return { status: "failed", error: "No paper found on the page", input };
  }
  if (paper.existing) { return { status: "duplicate", existingId: paper.existing.id, input }; }

  const pdf = await findPaperPdf(pdfFetchOptions(env), {
    ids: paper.ids,
    metadata: paper.metadata,
    landingUrl: page.finalUrl,
    pageCandidates: facts.pdfCandidates,
    input,
  });
  const record = await writeImportedPaper(ctx, env.importDeps().takenIds(), targetDir, {
    metadata: { ...paper.metadata, title: normalizeTitle(title) },
    pdf: pdf?.bytes,
    pdfVersion: pdf?.version,
    extra: { ...(paper.ids.doi && !paper.metadata.doi ? { doi: paper.ids.doi } : {}) },
    log: { message: "Paper imported from landing page", context: { url: page.finalUrl, origin: paper.origin } },
  });
  return { status: "added", record, needsReview: false, input };
}
