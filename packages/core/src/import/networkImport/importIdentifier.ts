/** Imports a paper from an identifier: resolves its record through the registries and looks for its PDF. */
import type { ImportOutcome } from "../../library/index.js";
import { describeError } from "../../logging/index.js";
import type { DetectedIdentifier, DetectedIds } from "../identifiers/index.js";
import { identifiersFromInput } from "../identifiers/index.js";
import type { ResolvedMetadata } from "../metadata/index.js";
import { resolveOnlineMetadata } from "../lookup/index.js";
import { NETWORK_IMPORT_MODULE, type NetworkImportEnv } from "./env.js";
import { findPdf } from "./findPdf.js";
import { writeImportedPaper } from "./writeImportedPaper.js";

interface Found {
  metadata: ResolvedMetadata;
  identifier: DetectedIdentifier;
}

/**
 * Imports a paper from an identifier or a URL containing one. The PDF comes from the core chain; when none downloads,
 * the paper is saved as a reference without one.
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
    const pdf = await findPdfFor(env, found, input);
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
    const { message } = describeError(error);
    await env.ctx.logger.log("WARN", NETWORK_IMPORT_MODULE, "Identifier import failed", { input, message });
    return { status: "failed", error: message, input };
  }
}

// Books have no PDF to look for.
function findPdfFor(env: NetworkImportEnv, { metadata, identifier }: Found, input: string): Promise<Uint8Array | undefined> {
  if (identifier.type === "isbn") { return Promise.resolve(undefined); }
  const ids: DetectedIds = {
    ...(identifier.type === "doi" ? { doi: identifier.value } : {}),
    ...(identifier.type === "arxiv" ? { arxivId: identifier.value } : {}),
    ...(identifier.type === "pmid" ? { pmid: identifier.value } : {}),
  };
  return findPdf(env, { ids, metadata, input, ...(identifier.type === "pmcid" ? { pmcid: identifier.value } : {}) });
}

async function firstResolved(env: NetworkImportEnv, identifiers: DetectedIdentifier[]): Promise<Found | undefined> {
  const resolve = env.resolveIdentifier ?? resolveOnlineMetadata;
  for (const identifier of identifiers) {
    try {
      const metadata = await resolve(identifier);
      if (metadata?.title) { return { metadata, identifier }; }
    } catch (error) {
      await env.ctx.logger.log("WARN", NETWORK_IMPORT_MODULE, "Registry lookup failed", { identifier, message: describeError(error).message });
    }
  }
  return undefined;
}
