/** Fans one free-text query out to every registry that supports it. */
import {
  crossRefSearch,
  dblpSearch,
  europePmcSearch,
  openAlexSearch,
  semanticScholarByTitle,
  type RegistryRecord,
} from "../registries/index.js";

export function searchAllRegistries(query: string, rows = 3): Array<Promise<RegistryRecord[]>> {
  const single = (promise: Promise<RegistryRecord | undefined>): Promise<RegistryRecord[]> =>
    promise.then((record) => (record ? [record] : [])).catch(() => []);

  return [
    crossRefSearch(query, rows).catch((): RegistryRecord[] => []),
    openAlexSearch(query, rows).catch((): RegistryRecord[] => []),
    europePmcSearch(query, rows).catch((): RegistryRecord[] => []),
    dblpSearch(query, rows).catch((): RegistryRecord[] => []),
    single(semanticScholarByTitle(query)),
  ];
}
