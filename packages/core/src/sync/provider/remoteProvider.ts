// Declares the provider-agnostic contract of a remote storage backend used by the sync engine.

/** A namespace splits visible library content, hidden app data and the writing projects. */
export type RemoteNamespace = "library" | "appdata" | "projects";

/** A file or folder as seen on the remote side. */
export interface RemoteFile {
  id: string;
  name: string;
  isFolder: boolean;
  /** ISO-8601 timestamp of the last remote modification. */
  modifiedTime: string;
  size?: number;
}

/**
 * Abstraction over a remote storage backend. Implementations live in the
 * platform layer (e.g. googleDriveProvider.ts) and must not leak transport
 * details. The sync engine only depends on this interface.
 */
export interface RemoteProvider {
  /** Stable provider identifier, e.g. "google-drive". */
  readonly id: string;
  readonly displayName: string;

  /** Triggers authentication and persists credentials. */
  connect(): Promise<void>;
  /** Clears persisted credentials. */
  disconnect(): Promise<void>;
  isConnected(): boolean;

  /** Resolves (creating if needed) the root folder for a namespace. */
  resolveRoot(ns: RemoteNamespace): Promise<RemoteFile>;
  /** Looks the root folder of a namespace up without creating it. */
  findRoot(ns: RemoteNamespace): Promise<RemoteFile | undefined>;
  /** Lists direct children of a folder. */
  list(folderId: string): Promise<RemoteFile[]>;
  createFolder(parentId: string, name: string): Promise<RemoteFile>;
  /** Uploads content, replacing existingId when provided. */
  upload(
    parentId: string,
    name: string,
    content: Uint8Array,
    existingId?: string,
  ): Promise<RemoteFile>;
  download(fileId: string): Promise<Uint8Array>;
  remove(fileId: string): Promise<void>;
  move(
    fileId: string,
    newParentId: string,
    newName?: string,
  ): Promise<RemoteFile>;
}
