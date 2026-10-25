// Watches the library on disk so changes made elsewhere show up in the TUI within a fraction of a second.
// Uses recursive fs.watch and polls the papers folder when recursive watching is unavailable.
// Also notices when the library folder disappears (unmounted drive, sync client) and re-arms when it returns.
import { promises as fsp, watch, type FSWatcher } from "node:fs";

import { LibraryRootPresenceMonitor, formatError, isExternalChangeNoise, type ILogger } from "@labshelf/core";

import { LibraryRoot } from "./libraryRoot.js";

const DEBOUNCE_MS = 250;
const POLL_MS = 5_000;

async function folderExists(dir: string): Promise<boolean> {
  try {
    await fsp.stat(dir);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") { return false; }
    throw error;
  }
}

export class LibraryWatcher {
  private watchers: FSWatcher[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private poll: ReturnType<typeof setInterval> | undefined;

  private readonly monitor: LibraryRootPresenceMonitor;

  constructor(
    private readonly paths: LibraryRoot,
    private readonly onChange: () => void,
    private readonly logger: ILogger,
    onRootLost: () => void,
  ) {
    this.monitor = new LibraryRootPresenceMonitor({
      exists: () => folderExists(paths.root),
      logger,
      onLost: () => { this.disarm(); onRootLost(); },
      onReturned: () => { this.arm(); this.onChange(); },
    });
  }

  /**
   * Starts watching papers/, the sidecar folder and projects/, and checks that the library folder stays present.
   */
  start(): void {
    this.arm();
    this.monitor.start();
  }

  stop(): void {
    this.monitor.stop();
    this.disarm();
  }

  /** Whether the library folder exists right now. */
  rootPresent(): Promise<boolean> {
    return this.monitor.check();
  }

  private arm(): void {
    const { layout } = this.paths;
    for (const dir of [layout.papersRoot(), layout.paperDataRoot(), layout.projectsRoot()]) {
      try {
        const watcher = watch(dir, { recursive: true, persistent: false }, (_event, file) => {
          if (typeof file !== "string" || !isExternalChangeNoise(file)) { this.schedule(); }
        });
        watcher.on("error", (error) => {
          void this.logger.log("WARN", "terminal/libraryWatcher", "Watcher failed, polling instead", { dir, message: String(error) });
          this.startPolling();
        });
        this.watchers.push(watcher);
      } catch (error) {
        // projects/ does not exist until the first writing project is created; there is nothing to poll for.
        if ((error as { code?: string }).code === "ENOENT") { continue; }
        void this.logger.log("WARN", "terminal/libraryWatcher", "Recursive watch unavailable, polling instead", {
          dir, message: formatError(error),
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

  private disarm(): void {
    clearTimeout(this.timer);
    if (this.poll) { clearInterval(this.poll); }
    this.poll = undefined;
    for (const watcher of this.watchers) { watcher.close(); }
    this.watchers = [];
  }
}
