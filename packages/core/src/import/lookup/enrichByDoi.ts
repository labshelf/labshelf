/** Fills fields the confirming registry left blank by asking the registries not yet used. */
import { SOURCE_TRUST, type MetadataSource } from "../metadata/index.js";
import { europePmcSearch, plainRecord, semanticScholarByDoi, type RegistryRecord } from "../registries/index.js";

/**
 * Queries the registries that were not used to confirm the identifier, to fill
 * fields the first one left blank — most often the abstract, which CrossRef
 * omits for a large share of its records.
 * @returns One source entry per registry that answered.
 */
export async function enrichByDoi(doi: string): Promise<MetadataSource[]> {
  const [semanticScholar, europePmc] = await Promise.all([
    semanticScholarByDoi(doi).catch(() => undefined),
    europePmcSearch(`DOI:"${doi}"`, 1).catch((): RegistryRecord[] => []),
  ]);

  const sources: MetadataSource[] = [];
  if (semanticScholar?.title) {
    sources.push({ name: "semanticscholar", trust: SOURCE_TRUST.enrichment, metadata: plainRecord(semanticScholar) });
  }
  const europePmcRecord = europePmc[0];
  if (europePmcRecord?.title) {
    sources.push({ name: "europepmc", trust: SOURCE_TRUST.enrichment, metadata: plainRecord(europePmcRecord) });
  }
  return sources;
}
