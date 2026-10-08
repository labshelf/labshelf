/**
 * Imports that start from the network: an identifier (DOI, arXiv, PMID, ISBN) resolved through the registries, or a
 * URL that serves a PDF or a landing page. All write through the core mutation context.
 */
import {
  describeError,
  identifiersFromInput,
  importPdf,
  resolveOnlineMetadata,
  type DetectedIdentifier,
  type ImportDeps,
  type ImportOutcome,
  type MutationContext,
  type PaperRecord,
  type ResolvedMetadata,
} from "@labshelf/core";
import * as path from "node:path";

import { downloadPdf, fetchBytes, isHtml, isPdf } from "./downloads.js";
import { importLandingPage } from "./landingImport.js";
import { writeImportedPaper } from "./writeImportedPaper.js";

export interface NetworkImportEnv {
  ctx: MutationContext;
  tmpDir: string;
  /** Read at each import, so it reflects the papers the earlier imports added. */
  importDeps(): ImportDeps;
  /** Read at each import, so it reflects the papers the earlier imports added. */
  records(): PaperRecord[];
  fetch?: typeof fetch;
  /** Network metadata lookups; injectable for tests. */
  resolveIdentifier?: (identifier: DetectedIdentifier) => Promise<ResolvedMetadata | undefined>;
  searchByTitle?: (title: string) => Promise<ResolvedMetadata | undefined>;
}

const MODULE = "terminal/paperService";

/**
 * Imports a paper from an identifier or a URL containing one. arXiv papers come with their PDF; others are saved as a
 * reference without a PDF, like the browser extension does.
 * @returns what happened
 */
export async function importIdentifier(env: NetworkImportEnv, input: string, targetDir: string): Promise<ImportOutcome> {
  const identifiers = identifiersFromInput(input);
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
    const pdf = isArxiv ? await downloadPdf(env.fetch ?? fetch, `https://arxiv.org/pdf/${identifier.value}`).catch(() => undefined) : undefined;
    const record = await writeImportedPaper(env.ctx, deps, targetDir, {
      metadata,
      pdf,
      extra: {
        ...(identifier.type === "doi" && !metadata.doi ? { doi: identifier.value } : {}),
        ...(isArxiv && !metadata.url ? { url: `https://arxiv.org/abs/${identifier.value}` } : {}),
      },
      ...(isArxiv ? { sourceName: `${identifier.value}.pdf` } : {}),
      log: { message: "Paper imported from identifier", context: { type: identifier.type, value: identifier.value } },
    });
    return { status: "added", record, needsReview: false, input };
  } catch (error) {
    const message = describeError(error).message;
    await env.ctx.logger.log("WARN", MODULE, "Identifier import failed", { input, message });
    return { status: "failed", error: message, input };
  }
}

/**
 * Imports what a URL serves: a PDF is imported under the name in the URL; a landing page is read for the paper it
 * describes.
 * @returns what happened
 */
export async function importUrl(env: NetworkImportEnv, url: string, targetDir: string): Promise<ImportOutcome> {
  const { ctx } = env;
  let tmp: string | undefined;
  try {
    const downloaded = await fetchBytes(env.fetch ?? fetch, url);
    if (!isPdf(downloaded.bytes)) {
      if (!isHtml(downloaded)) { throw new Error("The URL did not return a PDF"); }
      return await importLandingPage(env, downloaded, url, targetDir);
    }
    tmp = path.join(env.tmpDir, `download-${Date.now()}.pdf`);
    await ctx.fs.ensureDir(env.tmpDir);
    await ctx.fs.writeFile(tmp, downloaded.bytes);
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "download.pdf");
    return await importPdf(ctx, env.importDeps(), tmp, targetDir, {
      sourceName: name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`,
    });
  } catch (error) {
    const message = describeError(error).message;
    await ctx.logger.log("WARN", MODULE, "URL import failed", { url, message });
    return { status: "failed", error: message, input: url };
  } finally {
    if (tmp) { await ctx.fs.deleteFile(tmp).catch(() => undefined); }
  }
}

async function firstResolved(
  env: NetworkImportEnv,
  identifiers: DetectedIdentifier[],
): Promise<{ metadata: ResolvedMetadata; identifier: DetectedIdentifier } | undefined> {
  const resolve = env.resolveIdentifier ?? resolveOnlineMetadata;
  for (const identifier of identifiers) {
    const metadata = await resolve(identifier).catch(() => undefined);
    if (metadata?.title) { return { metadata, identifier }; }
  }
  return undefined;
}
