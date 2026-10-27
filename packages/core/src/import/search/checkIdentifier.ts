/** Confirms identifiers printed in a PDF against the registry that issued them. */
import { deriveDoiVariants, type DetectedIdentifier } from "../identifiers/index.js";
import {
  fetchArxivByIdentifier,
  fetchCrossrefByDoi,
  fetchDataciteByDoi,
  fetchGoogleBooksByIsbn,
  openLibraryByIsbn,
  derivePlainMetadata,
  resolvePmidFromPmcid,
  fetchPubmedByPmid,
  type RegistryEnv,
  type ResolvedMetadata,
} from "../registries/index.js";

/**
 * Identifiers recovered from a PDF are candidates, not facts: OCR misreads
 * digits, and a DOI scraped from the text may belong to a cited work.
 * @returns The registry record, or undefined when nothing resolves.
 */
export async function resolveOnlineMetadata(
  identifier: DetectedIdentifier,
  env: RegistryEnv = {},
): Promise<ResolvedMetadata | undefined> {
  switch (identifier.type) {
    case "doi": {
      // Publishers mint component DOIs for abstracts and figures; those records
      // exist but describe a fragment, so the parent DOI is tried as well.
      for (const variant of deriveDoiVariants(identifier.value)) {
        const record = await fetchCrossrefByDoi(env, variant);
        if (record?.title && !record.isComponent) {
          return derivePlainMetadata(record);
        }
      }
      for (const variant of deriveDoiVariants(identifier.value)) {
        const record = await fetchDataciteByDoi(env, variant);
        if (record?.title) {
          return derivePlainMetadata(record);
        }
      }
      return undefined;
    }
    case "arxiv":
      return derivePlainMetadata(await fetchArxivByIdentifier(env, identifier.value));
    case "pmid":
      return derivePlainMetadata(await fetchPubmedByPmid(env, identifier.value));
    case "pmcid": {
      const pmid = await resolvePmidFromPmcid(env, identifier.value);
      return pmid ? derivePlainMetadata(await fetchPubmedByPmid(env, pmid)) : undefined;
    }
    case "isbn": {
      const book = await openLibraryByIsbn(env, identifier.value);
      return derivePlainMetadata(book?.title ? book : await fetchGoogleBooksByIsbn(env, identifier.value));
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
  env: RegistryEnv = {},
): Promise<{ metadata: ResolvedMetadata; identifier: DetectedIdentifier } | undefined> {
  for (const identifier of identifiers) {
    const metadata = await resolveOnlineMetadata(identifier, env).catch(() => undefined);
    if (metadata?.title) {
      return { metadata, identifier };
    }
  }
  return undefined;
}
