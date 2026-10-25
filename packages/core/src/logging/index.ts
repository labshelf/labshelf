/** Exports the logging public API: entry construction, error text, the Logger and its sink fan-out. */
export { createLogEntry, describeError, formatError, formatLogLine } from "./logEntry.js";
export { Logger, type LoggerOptions } from "./logger.js";
