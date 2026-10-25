// Embeds a query and returns the vector store's top-k matches unchanged.
// The store owns filtering and ranking.
import type { IEmbeddingProvider } from "./embeddingProvider.js";
import type { IVectorStore, VectorFilter, VectorMatch } from "./vectorStore.js";

export interface RetrieveOptions {
  k?: number;
  filter?: VectorFilter;
}

/**
 * Retrieves the top-k most similar chunks for a free-text query.
 *
 * @returns Vector matches sorted by descending score.
 */
export async function findTopK(
  query: string,
  embedder: IEmbeddingProvider,
  store: IVectorStore,
  options: RetrieveOptions = {},
): Promise<VectorMatch[]> {
  const k = options.k ?? 10;
  const [embedding] = await embedder.embed([query]);
  if (!embedding) return [];
  return store.search(embedding, k, options.filter);
}
