/** The library's VS Code file-system adapter over vscode.workspace.fs, and the watcher that detects changes made outside this window. */
import * as vscode from "vscode";

import { SIDECAR_FILE, createDebouncer, createLibraryLayout, formatError, isExternalChangeNoise } from "@labshelf/core";
import type { Debouncer, LibraryFileSystem, LibraryLayout, LocalStat, PathOps } from "@labshelf/core";
import { disposeAll } from "../disposables/index.js";


const isNotFound = (error: unknown): boolean => (error as { code?: string }).code === "FileNotFound";

/** Names the URI of a path; the scheme depends on where the path lives. */
export type UriOfPath = (target: string) => vscode.Uri;

export class VscodeFileSystem implements LibraryFileSystem {
  private readonly tmpDir: string | undefined;

  /** @param root the library whose temp folder stages writes inside it; undefined stages every write next to its target */
  constructor(private readonly root: string | undefined, private readonly paths: PathOps, private readonly uriOf: UriOfPath) {
    this.tmpDir = root === undefined ? undefined : createLibraryLayout(root, paths.join).tmpDir();
  }

  async ensureDir(dirPath: string): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(this.uriOf(dirPath));
    } catch (error) {
      const message = formatError(error);
      throw new Error(`Failed to ensure directory ${dirPath}: ${message}`, { cause: error });
    }
  }

  async writeText(filePath: string, content: string): Promise<void> {
    await this.writeFile(filePath, new TextEncoder().encode(content));
  }

  // Written to a temp file and renamed into place, so a reader, a sync scan or the other app never sees half a file.
  async writeFile(filePath: string, content: Uint8Array): Promise<void> {
    await this.ensureDir(this.paths.dirname(filePath));
    const tmpDir = this.tmpDirFor(filePath);
    await this.ensureDir(tmpDir);
    const tmp = this.uriOf(this.paths.join(tmpDir, `.${this.paths.basename(filePath)}.${globalThis.crypto.randomUUID()}.tmp`));
    try {
      await vscode.workspace.fs.writeFile(tmp, content);
      await vscode.workspace.fs.rename(tmp, this.uriOf(filePath), { overwrite: true });
    } catch (error) {
      // Best effort: the write error below is the one the caller needs, and a stray temp file is harmless.
      await Promise.resolve(vscode.workspace.fs.delete(tmp, { useTrash: false })).catch(() => undefined);
      const message = formatError(error);
      throw new Error(`Failed to write ${filePath}: ${message}`, { cause: error });
    }
  }

  // TRAP: device-local caches live on another volume than the library, and a rename across volumes fails with EXDEV,
  // so a target outside the library stages next to itself.
  private tmpDirFor(filePath: string): string {
    if (this.root === undefined || this.tmpDir === undefined) { return this.paths.dirname(filePath); }
    const relative = this.paths.relative(this.root, filePath);
    const insideLibrary = relative !== "" && relative.split(this.paths.sep)[0] !== ".." && !this.paths.isAbsolute(relative);
    return insideLibrary ? this.tmpDir : this.paths.dirname(filePath);
  }

  async readText(filePath: string): Promise<string> {
    return new TextDecoder("utf-8", { ignoreBOM: true }).decode(await this.readFile(filePath));
  }

  async readFile(filePath: string): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(this.uriOf(filePath));
  }

  /** True for files and folders. */
  async exists(target: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(this.uriOf(target));
      return true;
    } catch {
      return false;
    }
  }

  // Only a missing folder lists as empty: an import walk must be able to report a folder it may not read.
  async listDir(dirPath: string): Promise<string[]> {
    try {
      return (await vscode.workspace.fs.readDirectory(this.uriOf(dirPath))).map(([name]) => name);
    } catch (error) {
      if (isNotFound(error)) { return []; }
      throw error;
    }
  }

  // A missing file is already deleted; any other failure (permissions, a locked file) still surfaces.
  async deleteFile(filePath: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(this.uriOf(filePath), { useTrash: false });
    } catch (error) {
      if (isNotFound(error)) { return; }
      throw error;
    }
  }

  // VS Code allows a rename that changes only letter case even without overwrite, so "ml" → "ML" works on macOS.
  async rename(from: string, to: string): Promise<void> {
    await vscode.workspace.fs.rename(this.uriOf(from), this.uriOf(to), { overwrite: false });
  }

  async removeTree(target: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(this.uriOf(target), { recursive: true, useTrash: false });
    } catch (error) {
      if (isNotFound(error)) { return; }
      throw error;
    }
  }

  async trash(target: string): Promise<void> {
    await vscode.workspace.fs.delete(this.uriOf(target), { recursive: true, useTrash: true });
  }

  async mkdir(dir: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.uriOf(dir));
  }

  // FileType is a bit flag and a symlink reports File|SymbolicLink: the strict comparison leaves symlinks out.
  async stat(target: string): Promise<LocalStat | undefined> {
    try {
      const s = await vscode.workspace.fs.stat(this.uriOf(target));
      return {
        isFile: s.type === vscode.FileType.File,
        isDirectory: s.type === vscode.FileType.Directory,
        mtimeMs: s.mtime,
        size: s.size,
      };
    } catch {
      return undefined;
    }
  }
}

// Detects library changes made outside this window (terminal app, sync, file manager) and triggers a re-index.
// Watches papers/**, the sidecars and projects/** (conflict copies of writing projects); a burst of events is debounced into one re-index.
const DEBOUNCE_MS = 1_000;

export class ExternalChangeWatcher implements vscode.Disposable {
  private readonly watchers: vscode.FileSystemWatcher[] = [];
  private readonly reindex: Debouncer<[]>;

  constructor(paths: LibraryLayout<vscode.Uri>, private readonly onChange: () => void, private readonly debounceMs = DEBOUNCE_MS) {
    this.reindex = createDebouncer(() => this.onChange(), this.debounceMs);
    const patterns = [
      new vscode.RelativePattern(paths.papersRoot(), "**"),
      new vscode.RelativePattern(paths.paperDataRoot(), `**/${SIDECAR_FILE}`),
      new vscode.RelativePattern(paths.projectsRoot(), "**"),
    ];
    for (const pattern of patterns) {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const schedule = (uri: vscode.Uri): void => this.schedule(uri);
      watcher.onDidCreate(schedule);
      watcher.onDidChange(schedule);
      watcher.onDidDelete(schedule);
      this.watchers.push(watcher);
    }
  }

  private schedule(uri: vscode.Uri): void {
    if (isExternalChangeNoise(uri.fsPath)) { return; }
    this.reindex.call();
  }

  dispose(): void {
    this.reindex.cancel();
    disposeAll(this.watchers);
  }
}
