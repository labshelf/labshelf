// Exports the labshelf-project: file system provider for the editor page.
export { createProjectFileSystemProvider, type ProjectFileSystemDeps } from "./projectFileSystemProvider";
export { ProjectFileSystemError, type FileSystemErrorCode } from "./fileSystemError";
export { PROJECT_SCHEME } from "./projectUri";
export {
  FileChangeType, FileType,
  type FileChange, type FileStat, type ProjectFileSystemProvider, type ProjectUri,
} from "./types";
