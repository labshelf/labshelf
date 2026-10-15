// Builds the core Logger over the console and the storage ring; each extension page and the background create one.
import { Logger } from "@labshelf/core";
import { ConsoleLogSink } from "./consoleLogSink";
import { StorageRingLogSink } from "./storageRingLogSink";

/** `ring` is shared when the caller also reads the ring back (the options page). */
export function createBrowserLogger(ring: StorageRingLogSink = new StorageRingLogSink()): Logger {
  return new Logger([new ConsoleLogSink(), ring]);
}
