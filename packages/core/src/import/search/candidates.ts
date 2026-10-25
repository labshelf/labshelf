/** Lists every plausible registry match for a query so a human can choose between them. */
import type { ResolvedMetadata } from "../metadata/index.js";
import { derivePlainMetadata, type RegistryEnv } from "../registries/index.js";
import { searchAllRegistries } from "./registrySearch.js";
import { normalizeForMatch, deriveTitleOverlap } from "./titleMatch.js";

/**
 * Returns every plausible match for a query, best first, for a human to choose
 * between. A short title can match several real works closely — "Attention Is
 * All You Need" and the chapter "Is Attention All You Need?" score alike — so
 * an interactive lookup should offer the options rather than pick one.
 * @returns Deduplicated candidates ordered by how well they match the query.
 */
export async function searchOnlineCandidates(query: string, limit = 8, env: RegistryEnv = {}): Promise<ResolvedMetadata[]> {
  const normalized = normalizeForMatch(query);
  if (normalized.length < 6) {
    return [];
  }

  const searchTerm = normalized.slice(0, 600);
  const groups = await Promise.all(searchAllRegistries(env, searchTerm, limit));

  const byKey = new Map<string, { record: ResolvedMetadata; score: number }>();
  for (const record of groups.flat()) {
    if (!record.title || record.isComponent) {
      continue;
    }
    const key = (record.doi ?? record.title).toLowerCase();
    const score = deriveTitleOverlap(record.title, query);
    const existing = byKey.get(key);
    if (!existing || score > existing.score) {
      byKey.set(key, { record: derivePlainMetadata(record)!, score });
    }
  }

  return [...byKey.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.record);
}
