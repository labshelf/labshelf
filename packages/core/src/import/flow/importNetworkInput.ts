/** Imports what a person typed to add a paper from the network: an identifier, a link that names one, or a link to a PDF or an article page. */
import { type ImportOutcome, importPdf, isPdfBytes } from "../../library/index.js";
import { identifiersFromInput } from "../identifiers/index.js";
import { type NetworkImportEnv, NETWORK_IMPORT_MODULE, pdfFetchOptions, registryEnv } from "./env.js";
import { importIdentifier, type IdentifierImportOptions } from "./importIdentifier.js";
import { errorMessage } from "../../logging/index.js";
import { fetchBytes, isHtml, type Downloaded } from "./downloads.js";
import { interpretPage, parseHtmlPage } from "../landing/index.js";
import { normalizeTitle } from "../pdf/index.js";
import { findPaperPdf } from "../pdfFinder/index.js";
import { resolvePagePaper } from "../paper/index.js";
import { writeImportedPaper } from "./writeImportedPaper.js";

const MAX_HTML_BYTES = 5 * 1024 * 1024;

/**
 * Saves the paper a landing page describes with the PDF the core chain finds for it, or as a reference without a PDF
 * when none downloads.
 * @returns what happened
 */
async function importLandingPage(
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

/** @returns what happened */
async function importUrl(env: NetworkImportEnv, url: string, targetDir: string): Promise<ImportOutcome> {
  const { ctx } = env;
  let tmp: string | undefined;
  try {
    const downloaded = await fetchBytes(env, url);
    if (!isPdfBytes(downloaded.bytes)) {
      if (!isHtml(downloaded)) { throw new Error("The URL did not return a PDF"); }
      return await importLandingPage(env, downloaded, url, targetDir);
    }
    tmp = ctx.paths.join(env.tmpDir, `download-${Date.now()}.pdf`);
    await ctx.fs.ensureDir(env.tmpDir);
    await ctx.fs.writeFile(tmp, downloaded.bytes);
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "download.pdf");
    return await importPdf(ctx, env.importDeps(), tmp, targetDir, {
      sourceName: name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`,
    });
  } catch (error) {
    const message = errorMessage(error);
    await ctx.logger.log("WARN", NETWORK_IMPORT_MODULE, "URL import failed", { url, message });
    return { status: "failed", error: message, input: url };
  } finally {
    if (tmp) { await ctx.fs.deleteFile(tmp).catch(() => undefined); }
  }
}

/** A link that names an identifier (arxiv.org/abs/…, a DOI link) is imported through the registries, not downloaded. */
function isDirectUrl(input: string): boolean {
  return /^https?:\/\//i.test(input) && identifiersFromInput(input).length === 0;
}

/** @returns what happened; `options.citeKey` applies to identifiers only (a link to a PDF or page is keyed by its metadata) */
export function importNetworkInput(
  env: NetworkImportEnv,
  input: string,
  targetDir: string,
  options: IdentifierImportOptions = {},
): Promise<ImportOutcome> {
  return isDirectUrl(input) ? importUrl(env, input, targetDir) : importIdentifier(env, input, targetDir, options);
}
