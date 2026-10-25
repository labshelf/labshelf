// Builds the core Logger over the console and the storage ring; each extension page and the background create one.
import { Logger, type LogEntry, type LogSink } from "@labshelf/core";
import { StorageRingLogSink } from "./storageRingLogSink";

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

/** `ring` is shared when the caller also reads the ring back (the options page). */
export function createBrowserLogger(ring: StorageRingLogSink = new StorageRingLogSink()): Logger {
  return new Logger([new ConsoleLogSink(), ring]);
}
