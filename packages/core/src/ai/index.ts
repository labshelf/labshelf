/**
 * Exports the AI primitives' public API: platform-agnostic types, chunking, embedding, retrieval, the ingestion pipeline and the service.
 * SQLite persistence lives in ./node; UI lives in consumer packages.
 */
export * from "./chunk.js";
export * from "./embedding.js";
export * from "./ingestion.js";
export { AiService, createAiService, findSimilarPapers, findTopK } from "./aiService.js";
export type { AiServiceDependencies, AiServiceDeps, RetrieveOptions } from "./aiService.js";
