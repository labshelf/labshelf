/**
 * Exports the AI primitives' public API: platform-agnostic types, chunking, RAG and the ingestion pipeline.
 * SQLite persistence lives in ./node; UI lives in consumer packages.
 */
export * from "./types/index.js";
export * from "./chunking/index.js";
export * from "./rag/index.js";
export * from "./pipeline/index.js";
export * from "./embedding/index.js";
export * from "./indexer/index.js";
export * from "./service/index.js";
