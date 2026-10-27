/** Fills fields the confirming registry left blank by asking the registries not yet used. */
import { SOURCE_TRUST, searchEuropePmc, derivePlainMetadata, fetchSemanticScholarByDoi, type MetadataSource, type RegistryEnv, type RegistryEntry } from "../registries/index.js";

/**
 * Queries the registries that were not used to confirm the identifier, to fill
 * fields the first one left blank — most often the abstract, which CrossRef
 * omits for a large share of its records.
 * @returns One source entry per registry that answered.
 */
export async function fetchMetadataSourcesByDoi(doi: string, env: RegistryEnv = {}): Promise<MetadataSource[]> {
  const [semanticScholar, europePmc] = await Promise.all([
    fetchSemanticScholarByDoi(env, doi).catch(() => undefined),
    searchEuropePmc(env, `DOI:"${doi}"`, 1).catch((): RegistryEntry[] => []),
  ]);

  const sources: MetadataSource[] = [];
  if (semanticScholar?.title) {
    sources.push({ name: "semanticscholar", trust: SOURCE_TRUST.enrichment, metadata: derivePlainMetadata(semanticScholar) });
  }
  const europePmcRecord = europePmc[0];
  if (europePmcRecord?.title) {
    sources.push({ name: "europepmc", trust: SOURCE_TRUST.enrichment, metadata: derivePlainMetadata(europePmcRecord) });
  }
  return sources;
}
