// Chunks a paper and embeds the chunks into the vector store when both are supplied.
import type { ExtractedPdfText, PaperChunk } from "./chunk/index.js";
import type { IEmbeddingProvider, IVectorStore, VectorRecord } from "./embedding/index.js";
import { chunkBySection } from "./chunk/index.js";

export interface IngestionContext {
  embedder?: IEmbeddingProvider;
  vectorStore?: IVectorStore;
}

export interface IngestionResult {
  paperId: string;
  chunkCount: number;
  embeddedChunks: number;
}

/**
 * Runs the ingestion pipeline end-to-end for a single paper.
 *
 * @returns Counts of the chunks produced and embedded.
 */
export async function runIngestion(
  extracted: ExtractedPdfText,
  context: IngestionContext,
): Promise<IngestionResult> {
  const chunks = chunkBySection(extracted);
  const embeddedChunks = await embedAndStore(chunks, context);
  return {
    paperId: extracted.paperId,
    chunkCount: chunks.length,
    embeddedChunks,
  };
}

async function embedAndStore(
  chunks: PaperChunk[],
  context: IngestionContext,
): Promise<number> {
  if (!context.embedder || !context.vectorStore || chunks.length === 0) return 0;
  const texts = chunks.map((c) => c.text);
  const embeddings = await context.embedder.embed(texts);
  const payload = chunks
    .map((chunk, idx) => {
      const embedding = embeddings[idx];
      if (!embedding) return null;
      const record: VectorRecord = {
        id: 0,
        paperId: chunk.paperId,
        kind: chunk.kind,
        text: chunk.text,
        ...(chunk.section !== undefined ? { section: chunk.section } : {}),
        ...(chunk.page !== undefined ? { page: chunk.page } : {}),
      };
      return { record, embedding };
    })
    .filter((p): p is { record: VectorRecord; embedding: Float32Array } => p !== null);
  await context.vectorStore.upsert(payload);
  return payload.length;
}
