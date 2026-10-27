/** Builds and serialises structured log entries, the shape every sink stores. */
import type { LogEntry } from "../model/index.js";

export function createLogEntry(
  level: LogEntry["level"],
  module: string,
  message: string,
  context: Record<string, unknown> = {},
  stack?: string,
  now: () => Date = () => new Date(),
): LogEntry {
  return {
    timestamp: now().toISOString(),
    level,
    module,
    message,
    context,
    ...(stack ? { stack } : {}),
  };
}

/** One JSON line, the on-disk log format. */
export function formatLogLine(entry: LogEntry): string {
  return `${JSON.stringify(entry)}\n`;
}
