/** Imports what a person typed to add a paper from the network: an identifier, a link that names one, or a link to a PDF or an article page. */
import { type ImportOutcome, importPdf, isPdfBytes } from "../../library/index.js";
import { extractIdentifiersFromInput } from "../identifiers/index.js";
import { type NetworkImportEnv, NETWORK_IMPORT_MODULE, createPdfFinderOptions, createRegistryEnv } from "./env.js";
import { importIdentifier, type IdentifierImportOptions } from "./importIdentifier.js";
import { formatError } from "../../logging/index.js";
import { derivePageFacts, parseHtmlPage } from "../landing/index.js";
import { normalizeTitle } from "../pdf/index.js";
import { findPaperPdf } from "../pdfFinder/index.js";
import { resolvePagePaper } from "../paper/index.js";
import { writeImportedPaper } from "./writeImportedPaper.js";

interface Downloaded {
  bytes: Uint8Array;
  contentType: string;
  /** The URL after redirects; relative links on the page resolve against it. */
  finalUrl: string;
}

const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;
const HTML_SNIFF_BYTES = 1024;

/** @throws when the request fails or the file is larger than the cap */
async function fetchBytes(env: NetworkImportEnv, url: string): Promise<Downloaded> {
  const { fetch: doFetch, headers } = env.download;
  const response = await doFetch(url, { redirect: "follow", ...(headers ? { headers } : {}) });
  if (!response.ok) { throw new Error(`Download failed: HTTP ${response.status}`); }
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_DOWNLOAD_BYTES) { throw new Error("The file is too large"); }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "",
    finalUrl: response.url || url,
  };
}

/** Servers mislabel pages, so the body counts as well as the content type. */
function isHtml({ bytes, contentType }: Downloaded): boolean {
  if (/html/i.test(contentType)) { return true; }
  return /^\s*(<!doctype html|<html)/i.test(new TextDecoder().decode(bytes.slice(0, HTML_SNIFF_BYTES)));
}

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
  const facts = derivePageFacts(parseHtmlPage(new TextDecoder().decode(page.bytes.slice(0, MAX_HTML_BYTES)), page.finalUrl));
  const paper = await resolvePagePaper(facts, () => env.records(), {
    deps: {
      registry: createRegistryEnv(env),
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

  const pdf = await findPaperPdf(createPdfFinderOptions(env), {
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
    const message = formatError(error);
    await ctx.logger.log("WARN", NETWORK_IMPORT_MODULE, "URL import failed", { url, message });
    return { status: "failed", error: message, input: url };
  } finally {
    if (tmp) { await ctx.fs.deleteFile(tmp).catch(() => undefined); }
  }
}

/** A link that names an identifier (arxiv.org/abs/…, a DOI link) is imported through the registries, not downloaded. */
function isDirectUrl(input: string): boolean {
  return /^https?:\/\//i.test(input) && extractIdentifiersFromInput(input).length === 0;
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
