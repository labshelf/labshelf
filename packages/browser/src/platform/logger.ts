// Logs to the console and to a ring buffer in `bx.storage.local` that the options page displays.
// Implements core's ILogger.
import type { ILogger, LogEntry } from "@labshelf/core";
import { bx } from "./browserApi";

const STORAGE_KEY = "labshelf.log.ring";
const RING_CAPACITY = 200;

// One ring per JS context, shared by every logger in it: each module names
// its own logger ("background", "capture"), and per-instance buffers would
// overwrite each other's entries in storage.
const ring: { buffer: LogEntry[]; hydrated: boolean; hydration?: Promise<void> } = { buffer: [], hydrated: false };

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class BrowserLogger implements ILogger {
  constructor(private readonly defaultModule: string = "browser") {}

  async log(
    level: LogEntry["level"],
    module: string,
    message: string,
    context: Record<string, unknown> = {},
    stack?: string,
  ): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      context,
      ...(stack !== undefined ? { stack } : {}),
    };
    this.emitConsole(entry);
    await this.persist(entry);
  }

  async error(module: string, error: unknown, context: Record<string, unknown> = {}): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    await this.log("ERROR", module, message, context, stack);
  }

  async info(message: string, context: Record<string, unknown> = {}): Promise<void> {
    await this.log("INFO", this.defaultModule, message, context);
  }

  async warn(message: string, context: Record<string, unknown> = {}): Promise<void> {
    await this.log("WARN", this.defaultModule, message, context);
  }

  async recent(): Promise<LogEntry[]> {
    await this.hydrate();
    return [...ring.buffer];
  }

  private async persist(entry: LogEntry): Promise<void> {
    await this.hydrate();
    ring.buffer.push(entry);
    if (ring.buffer.length > RING_CAPACITY) {
      ring.buffer.splice(0, ring.buffer.length - RING_CAPACITY);
    }
    try {
      await bx.storage.local.set({ [STORAGE_KEY]: ring.buffer });
    } catch (error) {
      // Storage may be quota-restricted; in-memory copy is still valid. Console only: this is the logger.
      // eslint-disable-next-line no-console
      console.warn("[labshelf:logger] Could not persist the log ring", errorText(error));
    }
  }

  private emitConsole(entry: LogEntry): void {
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

  private hydrate(): Promise<void> {
    if (ring.hydrated) return Promise.resolve();
    if (ring.hydration) return ring.hydration;
    ring.hydration = (async () => {
      try {
        const stored = await bx.storage.local.get(STORAGE_KEY);
        const raw = stored[STORAGE_KEY];
        if (Array.isArray(raw)) {
          // Entries logged while hydrating stay after the stored ones.
          ring.buffer = [...(raw as LogEntry[]), ...ring.buffer];
        }
      } catch (error) {
        // A fresh buffer is fine. Console only: this is the logger.
        // eslint-disable-next-line no-console
        console.warn("[labshelf:logger] Could not read the stored log ring", errorText(error));
      }
      ring.hydrated = true;
    })();
    return ring.hydration;
  }
}
