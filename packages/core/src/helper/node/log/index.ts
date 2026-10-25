// Exports the helper's logger factory and the redaction it applies.
export { createHelperLogger, type HelperLogger } from "./helperLogger.js";
export { removeSecretsFromText, removeSecretsFromJson } from "./redact.js";
