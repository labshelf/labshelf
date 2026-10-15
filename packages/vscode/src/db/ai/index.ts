/** Public API of the AI subsystem's own SQLite persistence: its schema, stores and connection. */
export { ensureAiSchema } from "./aiSchema.js";
export { openAiDatabase } from "./openAiDatabase.js";
export { encodeEmbedding, decodeEmbedding } from "./embeddingCodec.js";
export { SqliteVectorStore } from "./sqliteVectorStore.js";
export { AiMetadataStore } from "./aiMetadataStore.js";
export { ReadingEventsStore } from "./readingEventsStore.js";
