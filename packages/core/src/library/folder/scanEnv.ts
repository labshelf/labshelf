/** Declares what a scan runs over: the file-system port, path style, logger and the cap on parallel file operations. */
import type { ILogger, LibraryFileSystem } from "../../ports/index.js";
import type { PaperEntry } from "../model/index.js";
import type { PathOps } from "../mutations/index.js";

/** Pools promises, so scanning a large library never has thousands of file operations in flight at once. */
type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

/** @returns a function that runs at most `max` of the tasks passed to it at a time */
export function createConcurrencyLimit(max: number): Limiter {
  let running = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= max) {
      // The finishing task hands its slot to this one, so the count never exceeds `max`.
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      running++;
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) { next(); } else { running--; }
    }
  };
}

/** The slice of the file-system port a scan reads through. */
export type ScanFileSystem = Pick<LibraryFileSystem, "listDir" | "stat" | "readText">;

export interface ScanEnv {
  fs: ScanFileSystem;
  ops: PathOps;
  logger: ILogger;
  limit: Limiter;
  /** The entries of the last scan by folder path; a paper whose metadata.yaml fails to parse keeps its entry. */
  previous: ReadonlyMap<string, PaperEntry>;
}

const SCAN_MODULE = "library/scan";
const MAX_PARALLEL_OPERATIONS = 32;

export function createScanEnv(fs: ScanFileSystem, ops: PathOps, logger: ILogger, previous: ReadonlyMap<string, PaperEntry> = new Map()): ScanEnv {
  return { fs, ops, logger, limit: createConcurrencyLimit(MAX_PARALLEL_OPERATIONS), previous };
}

/** Logs something the scan skipped, with the context to find it. */
export async function reportSkipped(env: ScanEnv, message: string, context: Record<string, unknown>): Promise<void> {
  await env.logger.log("WARN", SCAN_MODULE, message, context);
}
