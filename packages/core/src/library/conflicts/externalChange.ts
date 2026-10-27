// Detects external changes to the library folders: drops file-event noise, checks the library root is still there and handles each batch of changes.
import type { ILogger } from "../../ports/index.js";
import { formatError } from "../../errors/index.js";
import type { ConflictCopy } from "./conflictCopy.js";

const MODULE = "externalChange";

// Conflict copies are deliberately absent: they are library changes the conflict scan must see.
const NOISE_SEGMENTS = new Set([".dropbox.cache", ".stfolder", ".stversions"]);
const SCRATCH_FOLDERS = [".research/tmp", ".research/staging"];

const NOISE_NAMES = new Set([".DS_Store", "desktop.ini", "Thumbs.db", ".csync_journal.db", ".sync-exclude.lst", ".stignore"]);

const NOISE_NAME_PATTERNS: RegExp[] = [
  /^\..+\.tmp$/, // LabShelf atomic-write staging and Syncthing `.syncthing.<name>.tmp`
  /~$/, // editor backups
  /\.swp$/,
  /^\.dropbox-dist-tmp-/,
  /\.tmp\.(driveupload|drivedownload)$/,
  /^~\$/, // Office lock files
  /^\._/, // macOS resource forks
  /^\.~lock\./,
  /^\..+\.~[0-9a-f]+$/i, // Nextcloud temp download
  /^\.sync_[0-9a-f]{12}\.db(-shm|-wal)?$/i,
  /^~.*\.tmp$/, // Nextcloud and Syncthing-on-Windows temps
  /\.(part|filepart|crdownload|partial)$/,
];

/** Tells which file events in the library folders are not library changes: atomic-write temps, editor droppings and sync-tool bookkeeping. */
export function isExternalChangeNoise(path: string): boolean {
  const segments = path.split(/[\\/]/);
  const name = segments[segments.length - 1] ?? "";
  if (NOISE_NAMES.has(name) || NOISE_NAME_PATTERNS.some((pattern) => pattern.test(name))) return true;
  if (segments.some((segment) => NOISE_SEGMENTS.has(segment))) return true;
  const joined = `/${segments.join("/")}`;
  return SCRATCH_FOLDERS.some((folder) => joined.includes(`/${folder}/`));
}

export interface LibraryRootPresenceDeps {
  exists: () => Promise<boolean>;
  onLost: () => void;
  onReturned: () => void;
  logger: ILogger;
  intervalMs?: number;
}

// TRAP: scanLibrary returns an empty scan for a missing papers/ folder, so an unmounted root would empty the library on reindex.
export class LibraryRootPresenceMonitor {
  private present = true;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<boolean> | undefined;

  constructor(private readonly deps: LibraryRootPresenceDeps) {}

  start(): void {
    if (this.timer) return;
    const timer = setInterval(() => void this.check(), this.deps.intervalMs ?? 5000);
    (timer as { unref?: () => void }).unref?.();
    this.timer = timer;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Returns whether the root is present; overlapping calls share one check. */
  check(): Promise<boolean> {
    this.running ??= this.runCheck().finally(() => { this.running = undefined; });
    return this.running;
  }

  private async runCheck(): Promise<boolean> {
    let present: boolean;
    try {
      present = await this.deps.exists();
    } catch (error) {
      await this.deps.logger.log("WARN", MODULE, "Library folder check failed", { message: formatError(error) });
      return this.present;
    }
    if (present === this.present) return present;
    this.present = present;
    if (present) {
      await this.deps.logger.log("INFO", MODULE, "Library folder returned");
      this.deps.onReturned();
    } else {
      await this.deps.logger.log("WARN", MODULE, "Library folder not found");
      this.deps.onLost();
    }
    return present;
  }
}

export interface ChangeBatchDeps {
  logger: ILogger;
  isRootPresent: () => Promise<boolean>;
  scanConflicts: () => Promise<ConflictCopy[]>;
  reindex: () => Promise<void>;
  /** Receives every scan's unresolved copies, including an empty list, so a host can clear its conflict UI. */
  onConflicts: (copies: ConflictCopy[]) => void;
}

// A conflict-scan failure must not block the re-index: the library still has to pick up the change.
export async function applyChangeBatch(deps: ChangeBatchDeps): Promise<void> {
  if (!(await deps.isRootPresent())) return;
  try {
    const copies = await deps.scanConflicts();
    await deps.logger.log("INFO", MODULE, "Conflict copies scanned", { unresolved: copies.length });
    deps.onConflicts(copies);
  } catch (error) {
    await deps.logger.log("WARN", MODULE, "Conflict scan failed", { message: formatError(error) });
  }
  await deps.reindex();
}
