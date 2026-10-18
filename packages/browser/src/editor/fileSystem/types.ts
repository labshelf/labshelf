// Declares the VS Code FileSystemProvider shape the provider implements, so it plugs into monaco-vscode-api structurally.

/** A vscode.Uri reduced to the two parts the provider reads. */
export interface ProjectUri {
  readonly scheme: string;
  readonly path: string;
}

export const FileType = { File: 1, Directory: 2 } as const;
export const FileChangeType = { Changed: 1, Created: 2, Deleted: 3 } as const;

export interface FileStat {
  type: number;
  ctime: number;
  mtime: number;
  size: number;
}

export interface FileChange {
  type: number;
  resource: ProjectUri;
}

export interface Disposable {
  dispose(): void;
}

export interface ProjectFileSystemProvider {
  readonly onDidChangeFile: (listener: (changes: FileChange[]) => void) => Disposable;
  watch(uri: ProjectUri, options: { recursive: boolean; excludes: string[] }): Disposable;
  stat(uri: ProjectUri): Promise<FileStat>;
  readDirectory(uri: ProjectUri): Promise<Array<[string, number]>>;
  readFile(uri: ProjectUri): Promise<Uint8Array>;
  writeFile(uri: ProjectUri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): Promise<void>;
  delete(uri: ProjectUri, options: { recursive: boolean }): Promise<void>;
  rename(from: ProjectUri, to: ProjectUri, options: { overwrite: boolean }): Promise<void>;
  createDirectory(uri: ProjectUri): Promise<void>;
}
