/** Exports the Node side of linked outputs, shared by the VS Code extension host and the helper: the source folder's files and remote, its command and the folder dialog. */
export { MAX_SOURCE_FILES, listSourceFolder, pickFolderNative, readGitRemote, readSourceFile, runSourceCommand, type SourceCommandRun } from "./sourceFolder.js";
