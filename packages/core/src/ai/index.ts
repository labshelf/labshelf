/**
 * Exports the AI primitives' public API: platform-agnostic types, chunking, embedding, retrieval and the ingestion pipeline.
 * SQLite persistence lives in ./node; UI lives in consumer packages.
 */
export * from "./aiStorage.js";
export * from "./chunk/index.js";
export * from "./embedding/index.js";
export { runIngestion } from "./ingestion.js";
export type { IngestionContext, IngestionResult } from "./ingestion.js";
export { PdfTextExtractor } from "./pdfTextExtractor.js";
export { AiIndexer } from "./aiIndexer.js";
export type { AiIndexerDependencies } from "./aiIndexer.js";
export * from "./service/index.js";
