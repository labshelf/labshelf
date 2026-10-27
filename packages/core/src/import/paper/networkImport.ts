/** Imports a paper from the network: an identifier, a link that names one, a link to a PDF or an article page, and the write those imports share with page capture. */
import { type ImportDeps, type ImportOutcome, type MutationContext, createCiteKey, createPaper, deriveMetadataFields, importPdf, isPdfBytes, PDF_FILE } from "../../library/index.js";
import { formatError } from "../../errors/index.js";
import type { PaperRecord, PdfVersion } from "../../model/index.js";
import type { DetectedIdentifier, DetectedIds } from "../identifiers/index.js";
import { extractIdentifiersFromInput } from "../identifiers/index.js";
import { parseHtmlPage } from "../htmlPage.js";
import { derivePageFacts } from "../pageFacts.js";
import { normalizeTitle } from "../pdf/index.js";
import { findPaperPdf, type PdfFetchOptions, type ResolvedPdf } from "../pdfFinder/index.js";
import { resolveOnlineMetadata, type RegistryEnv, type ResolvedMetadata } from "../registries/index.js";
import { resolvePagePaper } from "./resolveMetadata.js";

export interface NetworkImportEnv {
  ctx: MutationContext;
  /** Where a downloaded PDF waits while the PDF import reads it. */
  tmpDir: string;
  /** Read at each import, so it reflects the papers the earlier imports added. */
  importDeps(): ImportDeps;
  /** Read at each import, so it reflects the papers the earlier imports added. */
  records(): PaperRecord[];
  /** The app's network: its `fetch` and the headers that identify it. Downloads log through `ctx.logger`. */
  download: { fetch: typeof fetch; headers?: Record<string, string> };
  /** Network metadata lookups; injectable for tests. */
  resolveIdentifier?: (identifier: DetectedIdentifier) => Promise<ResolvedMetadata | undefined>;
  searchByTitle?: (title: string) => Promise<ResolvedMetadata | undefined>;
}

const NETWORK_IMPORT_MODULE = "import/networkImport";

function createPdfFinderOptions(env: NetworkImportEnv): PdfFetchOptions {
  return { ...env.download, logger: env.ctx.logger };
}

/** Registry lookups go out on the app's fetch and log their failures through the app's logger. */
function createRegistryEnv(env: NetworkImportEnv): RegistryEnv {
  return { fetch: env.download.fetch, logger: env.ctx.logger };
}

export interface ImportedPaper {
  /** The title is stored as given. */
  metadata: ResolvedMetadata & { title: string };
  pdf?: Uint8Array | undefined;
  /** Which version `pdf` is, when its source said so. */
  pdfVersion?: PdfVersion | undefined;
  /** Fields set on top of the metadata (an identifier the user typed, an abstract URL, the user's tags). */
  extra?: Partial<Pick<PaperRecord, "doi" | "url" | "tags" | "note">>;
  /** The cite key the paper asks for instead of the one built from its metadata. */
  citeKey?: string;
  /** The file name the sidecar records as the paper's source. */
  sourceName?: string;
  /** What the log line says, and the context that identifies the import. */
  log: { message: string; context: Record<string, unknown> };
}

/** @returns the stored record */
export async function writeImportedPaper(
  ctx: MutationContext,
  takenIds: Iterable<string>,
  targetDir: string,
  paper: ImportedPaper,
): Promise<PaperRecord> {
  const { metadata, pdf } = paper;
  const record = await createPaper(ctx, takenIds, targetDir, {
    citeKey: paper.citeKey ?? createCiteKey(metadata, metadata.title),
    fields: { title: metadata.title, ...deriveMetadataFields(metadata), ...paper.extra, ...(pdf && paper.pdfVersion ? { pdfVersion: paper.pdfVersion } : {}) },
    pdf,
    sourceName: paper.sourceName ?? PDF_FILE,
  });
  if (paper.citeKey && record.id !== paper.citeKey) {
    await ctx.logger.log("WARN", NETWORK_IMPORT_MODULE, "Requested cite key was taken", { requested: paper.citeKey, id: record.id });
  }
  await ctx.logger.log("INFO", NETWORK_IMPORT_MODULE, paper.log.message, {
    ...paper.log.context, id: record.id, withPdf: Boolean(pdf), pdfVersion: paper.pdfVersion, targetDir,
  });
  return record;
}

interface Found {
  metadata: ResolvedMetadata;
  identifier: DetectedIdentifier;
}

export interface IdentifierImportOptions {
  /** The cite key the paper should get instead of the one built from its metadata; a taken one gets a letter suffix. */
  citeKey?: string;
}

/**
 * Imports a paper from an identifier or a URL containing one. The PDF comes from the core chain; when none downloads,
 * the paper is saved as a reference without one.
 * @returns what happened
 */
async function importIdentifier(
  env: NetworkImportEnv,
  input: string,
  targetDir: string,
  options: IdentifierImportOptions = {},
): Promise<ImportOutcome> {
  const identifiers = extractIdentifiersFromInput(input);
  if (!identifiers.length) { return { status: "failed", error: "No DOI, arXiv id, PMID or ISBN found", input }; }
  try {
    const found = await firstResolved(env, identifiers);
    if (!found) {
      return { status: "failed", error: `Could not find ${identifiers[0]!.type.toUpperCase()} ${identifiers[0]!.value}`, input };
    }
    const { metadata, identifier } = found;
    const deps = env.importDeps();
    const doi = metadata.doi ?? (identifier.type === "doi" ? identifier.value : undefined);
    const existingId = doi ? deps.findByDoi(doi) : undefined;
    if (existingId) { return { status: "duplicate", existingId, input }; }

    const isArxiv = identifier.type === "arxiv";
    const pdf = await findPdfFor(env, found, input);
    const record = await writeImportedPaper(env.ctx, deps.takenIds(), targetDir, {
      metadata: { ...metadata, title: normalizeTitle(metadata.title!) },
      pdf: pdf?.bytes,
      pdfVersion: pdf?.version,
      extra: {
        ...(identifier.type === "doi" && !metadata.doi ? { doi: identifier.value } : {}),
        ...(isArxiv && !metadata.url ? { url: `https://arxiv.org/abs/${identifier.value}` } : {}),
      },
      ...(isArxiv ? { sourceName: `${identifier.value}.pdf` } : {}),
      ...(options.citeKey ? { citeKey: options.citeKey } : {}),
      log: { message: "Paper imported from identifier", context: { type: identifier.type, value: identifier.value } },
    });
    return { status: "added", record, needsReview: false, input };
  } catch (error) {
    const message = formatError(error);
    await env.ctx.logger.log("WARN", NETWORK_IMPORT_MODULE, "Identifier import failed", { input, message });
    return { status: "failed", error: message, input };
  }
}

// Books have no PDF to look for.
async function findPdfFor(env: NetworkImportEnv, { metadata, identifier }: Found, input: string): Promise<ResolvedPdf | undefined> {
  if (identifier.type === "isbn") { return undefined; }
  const ids: DetectedIds = {
    ...(identifier.type === "doi" ? { doi: identifier.value } : {}),
    ...(identifier.type === "arxiv" ? { arxivId: identifier.value } : {}),
    ...(identifier.type === "pmid" ? { pmid: identifier.value } : {}),
  };
  return findPaperPdf(createPdfFinderOptions(env), { ids, metadata, input, ...(identifier.type === "pmcid" ? { pmcid: identifier.value } : {}) });
}

async function firstResolved(env: NetworkImportEnv, identifiers: DetectedIdentifier[]): Promise<Found | undefined> {
  const resolve = env.resolveIdentifier ?? ((identifier: DetectedIdentifier) => resolveOnlineMetadata(identifier, createRegistryEnv(env)));
  for (const identifier of identifiers) {
    try {
      const metadata = await resolve(identifier);
      if (metadata?.title) { return { metadata, identifier }; }
    } catch (error) {
      await env.ctx.logger.log("WARN", NETWORK_IMPORT_MODULE, "Registry lookup failed", { identifier, message: formatError(error) });
    }
  }
  return undefined;
}

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
