// Declares what reading project folders runs over: the file-system port, path arithmetic and the logger.
import type { PathOps } from "../../../path/index.js";
import type { ILogger, LibraryFileSystem } from "../../../ports/index.js";

export interface ProjectReadContext {
  fs: LibraryFileSystem;
  paths: PathOps;
  logger: ILogger;
}
