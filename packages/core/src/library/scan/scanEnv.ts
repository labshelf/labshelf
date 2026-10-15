/** Declares what a scan runs over: the file-system port, path style, logger and the cap on parallel file operations. */
import type { ILogger, LibraryFileSystem } from "../../ports/index.js";
import type { PathOps } from "../mutations/index.js";
import { concurrencyLimit, type Limiter } from "./concurrencyLimit.js";

/** The slice of the file-system port a scan reads through. */
export type ScanFileSystem = Pick<LibraryFileSystem, "listDir" | "stat" | "readText">;

export interface ScanEnv {
  fs: ScanFileSystem;
  ops: PathOps;
  logger: ILogger;
  limit: Limiter;
}

const SCAN_MODULE = "library/scan";
const MAX_PARALLEL_OPERATIONS = 32;

export function createScanEnv(fs: ScanFileSystem, ops: PathOps, logger: ILogger): ScanEnv {
  return { fs, ops, logger, limit: concurrencyLimit(MAX_PARALLEL_OPERATIONS) };
}

/** Logs something the scan skipped, with the context to find it. */
export async function warnSkipped(env: ScanEnv, message: string, context: Record<string, unknown>): Promise<void> {
  await env.logger.log("WARN", SCAN_MODULE, message, context);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
