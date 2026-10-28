// Builds the core Logger over the console and the storage ring, which keeps the latest entries for the options page;
// each extension page and the background create one.
import { Logger, formatError, type LogEntry, type LogSink } from "@labshelf/core";
import { bx } from "./bx";

const STORAGE_KEY = "labshelf.log.ring";
const RING_CAPACITY = 200;

// Storage failures go to the console only: this sink is the logger, so it cannot report through itself.
export class StorageRingLogSink implements LogSink {
  private buffer: LogEntry[] = [];
  private hydration?: Promise<void>;

  async append(entry: LogEntry): Promise<void> {
    await this.hydrate();
    this.buffer.push(entry);
    if (this.buffer.length > RING_CAPACITY) {
      this.buffer.splice(0, this.buffer.length - RING_CAPACITY);
    }
    try {
      await bx.storage.local.set({ [STORAGE_KEY]: this.buffer });
    } catch (error) {
      // Storage may be quota-restricted; the in-memory copy is still valid.
      // eslint-disable-next-line no-console
      console.warn("[labshelf:logger] Could not persist the log ring", formatError(error));
    }
  }

  async recent(): Promise<LogEntry[]> {
    await this.hydrate();
    return [...this.buffer];
  }

  private hydrate(): Promise<void> {
    this.hydration ??= (async () => {
      try {
        const stored = await bx.storage.local.get(STORAGE_KEY);
        const raw = stored[STORAGE_KEY];
        if (Array.isArray(raw)) {
          // Entries logged while hydrating stay after the stored ones.
          this.buffer = [...(raw as LogEntry[]), ...this.buffer];
        }
      } catch (error) {
        // A fresh buffer is fine.
        // eslint-disable-next-line no-console
        console.warn("[labshelf:logger] Could not read the stored log ring", formatError(error));
      }
    })();
    return this.hydration;
  }
}

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
