/** Confirms identifiers printed in a PDF against the registry that issued them. */
import { doiVariants, type DetectedIdentifier } from "../identifiers/index.js";
import type { ResolvedMetadata } from "../metadata/index.js";
import {
  arxivById,
  crossRefByDoi,
  dataCiteByDoi,
  googleBooksByIsbn,
  openLibraryByIsbn,
  plainRecord,
  pmidFromPmcid,
  pubMedByPmid,
} from "../registries/index.js";

/**
 * Identifiers recovered from a PDF are candidates, not facts: OCR misreads
 * digits, and a DOI scraped from the text may belong to a cited work.
 * @returns The registry record, or undefined when nothing resolves.
 */
export async function resolveOnlineMetadata(
  identifier: DetectedIdentifier,
): Promise<ResolvedMetadata | undefined> {
  switch (identifier.type) {
    case "doi": {
      // Publishers mint component DOIs for abstracts and figures; those records
      // exist but describe a fragment, so the parent DOI is tried as well.
      for (const variant of doiVariants(identifier.value)) {
        const record = await crossRefByDoi(variant);
        if (record?.title && !record.isComponent) {
          return plainRecord(record);
        }
      }
      for (const variant of doiVariants(identifier.value)) {
        const record = await dataCiteByDoi(variant);
        if (record?.title) {
          return plainRecord(record);
        }
      }
      return undefined;
    }
    case "arxiv":
      return plainRecord(await arxivById(identifier.value));
    case "pmid":
      return plainRecord(await pubMedByPmid(identifier.value));
    case "pmcid": {
      const pmid = await pmidFromPmcid(identifier.value);
      return pmid ? plainRecord(await pubMedByPmid(pmid)) : undefined;
    }
    case "isbn": {
      const book = await openLibraryByIsbn(identifier.value);
      return plainRecord(book?.title ? book : await googleBooksByIsbn(identifier.value));
    }
    default:
      return undefined;
  }
}

/**
 * Tries each detected identifier in turn until one resolves to a real record.
 * @returns The first confirmed record and the identifier that produced it.
 */
export async function resolveFirstIdentifier(
  identifiers: DetectedIdentifier[],
): Promise<{ metadata: ResolvedMetadata; identifier: DetectedIdentifier } | undefined> {
  for (const identifier of identifiers) {
    const metadata = await resolveOnlineMetadata(identifier).catch(() => undefined);
    if (metadata?.title) {
      return { metadata, identifier };
    }
  }
  return undefined;
}
