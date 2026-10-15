// Watches the library on disk so changes made elsewhere show up in the TUI within a fraction of a second.
// Uses recursive fs.watch and polls the papers folder when recursive watching is unavailable.
import { watch, type FSWatcher } from "node:fs";

import { errorMessage, isExternalChangeNoise, type ILogger } from "@labshelf/core";

import { LibraryRoot } from "./libraryRoot.js";

const DEBOUNCE_MS = 250;
const POLL_MS = 5_000;

export class LibraryWatcher {
  private watchers: FSWatcher[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private poll: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly paths: LibraryRoot,
    private readonly onChange: () => void,
    private readonly logger?: ILogger,
  ) {}

  /**
   * Starts watching papers/ and the sidecar folder.
   */
  start(): void {
    for (const dir of [this.paths.layout.papersRoot(), this.paths.layout.paperDataRoot()]) {
      try {
        const watcher = watch(dir, { recursive: true, persistent: false }, (_event, file) => {
          if (typeof file !== "string" || !isExternalChangeNoise(file)) { this.schedule(); }
        });
        watcher.on("error", (error) => {
          void this.logger?.log("WARN", "terminal/libraryWatcher", "Watcher failed, polling instead", { dir, message: String(error) });
          this.startPolling();
        });
        this.watchers.push(watcher);
      } catch (error) {
        void this.logger?.log("WARN", "terminal/libraryWatcher", "Recursive watch unavailable, polling instead", {
          dir, message: errorMessage(error),
        });
        this.startPolling();
      }
    }
  }

  private startPolling(): void {
    if (this.poll) { return; }
    this.poll = setInterval(() => this.onChange(), POLL_MS);
    this.poll.unref?.();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.onChange(), DEBOUNCE_MS);
  }

  stop(): void {
    clearTimeout(this.timer);
    if (this.poll) { clearInterval(this.poll); }
    for (const watcher of this.watchers) { watcher.close(); }
    this.watchers = [];
  }
}
