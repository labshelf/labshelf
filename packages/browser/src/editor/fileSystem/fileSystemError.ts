// Builds the errors the provider throws, named the way VS Code reads a FileSystemProvider failure.

/** Values of vscode's FileSystemProviderErrorCode that the provider uses. */
export type FileSystemErrorCode =
  | "EntryExists" | "EntryNotFound" | "EntryIsADirectory" | "NoPermissions" | "Unavailable";

export class ProjectFileSystemError extends Error {
  constructor(readonly code: FileSystemErrorCode, message: string, options?: { cause: unknown }) {
    super(message, options);
    // PLATFORM: VS Code recovers the error code from a name of the form "<code> (FileSystemError)".
    this.name = `${code} (FileSystemError)`;
  }
}
