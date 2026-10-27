/**
 * Exports the platform-abstracting ports that apps implement and inject.
 */
export type { IFileSystem, LocalStat, LocalFileSystem, LibraryFileSystem } from "./fileSystem.js";
export type { ILogger, LogSink, SidecarPort, FetchLike } from "./hostPorts.js";
