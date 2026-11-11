// A page's From paper… port whose implementation (pdf.js, the equation chain) loads on the first call.
import type { PaperObjectsPort } from "@labshelf/core/paperObjects";

/** Forwards every call to the port `load` resolves, calling `load` once. */
export function createLazyPaperObjects(load: () => Promise<PaperObjectsPort>): PaperObjectsPort {
  let port: Promise<PaperObjectsPort> | undefined;
  const get = (): Promise<PaperObjectsPort> => (port ??= load());
  return {
    papers: async (query) => (await get()).papers(query),
    list: async (paperId) => (await get()).list(paperId),
    preview: async (paperId, object) => (await get()).preview(paperId, object),
    insert: async (paperId, object, options) => (await get()).insert(paperId, object, options),
  };
}
