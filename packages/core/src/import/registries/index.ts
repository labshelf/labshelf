/** Exports the bibliographic registry clients and the record shape they return. */
export * from "./works/index.js";
export * from "./books/index.js";
export type { RegistryEnv } from "./http.js";
export { DEFAULT_CONTACT_EMAIL } from "./contactEmail.js";
export type { RegistryRecord } from "./types.js";
export { plainRecord } from "./plainRecord.js";
