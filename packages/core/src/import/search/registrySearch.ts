/** Fans one free-text query out to every registry that supports it. */
import {
  crossRefSearch,
  dblpSearch,
  europePmcSearch,
  openAlexSearch,
  semanticScholarByTitle,
  type RegistryEnv,
  type RegistryRecord,
} from "../registries/index.js";

export function searchAllRegistries(env: RegistryEnv, query: string, rows = 3): Array<Promise<RegistryRecord[]>> {
  const single = (promise: Promise<RegistryRecord | undefined>): Promise<RegistryRecord[]> =>
    promise.then((record) => (record ? [record] : [])).catch(() => []);

  return [
    crossRefSearch(env, query, rows).catch((): RegistryRecord[] => []),
    openAlexSearch(env, query, rows).catch((): RegistryRecord[] => []),
    europePmcSearch(env, query, rows).catch((): RegistryRecord[] => []),
    dblpSearch(env, query, rows).catch((): RegistryRecord[] => []),
    single(semanticScholarByTitle(env, query)),
  ];
}
