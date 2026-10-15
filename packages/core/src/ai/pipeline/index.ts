/**
 * Exports the ingestion pipeline's public API.
 */
export { extractMetadata } from "./extractMetadata.js";
export type { ExtractMetadataOptions } from "./extractMetadata.js";
export { runIngestion } from "./ingestionStages.js";
export type { IngestionContext, IngestionResult } from "./ingestionStages.js";
