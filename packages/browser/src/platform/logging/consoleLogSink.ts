// Writes each log entry to the browser console under a `[labshelf:<module>]` prefix.
import type { LogEntry, LogSink } from "@labshelf/core";

export class ConsoleLogSink implements LogSink {
  async append(entry: LogEntry): Promise<void> {
    const prefix = `[labshelf:${entry.module}]`;
    if (entry.level === "ERROR") {
      // eslint-disable-next-line no-console
      console.error(prefix, entry.message, entry.context);
    } else if (entry.level === "WARN") {
      // eslint-disable-next-line no-console
      console.warn(prefix, entry.message, entry.context);
    } else {
      // eslint-disable-next-line no-console
      console.info(prefix, entry.message, entry.context);
    }
  }
}
