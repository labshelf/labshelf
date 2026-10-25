/** Fans one free-text query out to every registry that supports it. */
import {
  searchCrossref,
  searchDblp,
  searchEuropePmc,
  openAlexSearch,
  fetchSemanticScholarByTitle,
  type RegistryEnv,
  type RegistryEntry,
} from "../registries/index.js";

export function searchAllRegistries(env: RegistryEnv, query: string, rows = 3): Array<Promise<RegistryEntry[]>> {
  const single = (promise: Promise<RegistryEntry | undefined>): Promise<RegistryEntry[]> =>
    promise.then((record) => (record ? [record] : [])).catch(() => []);

  return [
    searchCrossref(env, query, rows).catch((): RegistryEntry[] => []),
    openAlexSearch(env, query, rows).catch((): RegistryEntry[] => []),
    searchEuropePmc(env, query, rows).catch((): RegistryEntry[] => []),
    searchDblp(env, query, rows).catch((): RegistryEntry[] => []),
    single(fetchSemanticScholarByTitle(env, query)),
  ];
}
