// Takes a disk change of a file into its open, dirty document by a three-way merge against the text at last save, so VS Code never shows its "file is newer" dialog for a LabShelf-edited file.
// CONTRACT: documents/contracts/local-sync.md#hosts
import * as vscode from "vscode";
import { mergeLocalFile, type ILogger, type TextMerge } from "@labshelf/core";

import { replaceDocumentText } from "./documentText.js";

export interface DiskMerge { track(document: vscode.TextDocument): vscode.Disposable; dispose(): void }

interface Tracked {
  readonly document: vscode.TextDocument;
  refs: number;
  base: string | undefined;
  queue: Promise<void>;
  readonly disposables: vscode.Disposable[];
}

const MODULE = "localSync.diskMerge";
const REVERT = "workbench.action.files.revert";

function fileName(fsPath: string): string {
  return fsPath.split(/[\\/]/).pop() ?? fsPath;
}

function folderOf(uri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(uri, "..");
}

async function readDisk(uri: vscode.Uri): Promise<string> {
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

async function takeDiskChange(entry: Tracked, textMerge: TextMerge): Promise<void> {
  const { document } = entry;
  if (document.isClosed) return;
  const disk = await readDisk(document.uri);
  if (!document.isDirty) { entry.base = disk; return; }
  if (disk === entry.base) return;
  const merged = mergeLocalFile({ path: document.uri.fsPath, base: entry.base ?? disk, local: document.getText(), other: disk }, textMerge);
  if (merged.conflict) {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(merged.conflict.copyPath), new TextEncoder().encode(merged.conflict.text));
  }
  await vscode.commands.executeCommand(REVERT, document.uri);
  if (merged.text !== disk) {
    await replaceDocumentText(document, merged.text);
    await document.save();
  }
  entry.base = merged.text;
  if (merged.conflict) {
    const copy = fileName(merged.conflict.copyPath);
    void vscode.window.showWarningMessage(`LabShelf kept your edits in ${fileName(document.uri.fsPath)}; the version saved on disk is in ${copy}.`);
  }
}

/** Watches the document's file and its saves; a disk change queues a merge, a save moves the base. */
function watchDocument(entry: Tracked, key: string, enqueue: (work: () => Promise<void>) => void, textMerge: TextMerge): vscode.Disposable[] {
  const { document } = entry;
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folderOf(document.uri), fileName(document.uri.path)));
  const onDisk = (): void => { enqueue(() => takeDiskChange(entry, textMerge)); };
  return [
    watcher,
    watcher.onDidChange(onDisk),
    watcher.onDidCreate(onDisk),
    vscode.workspace.onDidSaveTextDocument((saved) => {
      if (saved.uri.toString() === key) entry.base = saved.getText();
    }),
  ];
}

export function createDiskMerge(deps: { textMerge: TextMerge; logger?: ILogger }): DiskMerge {
  const tracked = new Map<string, Tracked>();

  const report = (error: unknown, uri: vscode.Uri): void => {
    void deps.logger?.error(MODULE, error, { path: uri.fsPath }).catch(() => undefined);
  };

  /** Runs work after the file's earlier work; a failure is logged, never thrown. */
  const enqueue = (entry: Tracked, work: () => Promise<void>): void => {
    entry.queue = entry.queue.then(work).catch((error: unknown) => report(error, entry.document.uri));
  };

  const start = (document: vscode.TextDocument, key: string): Tracked => {
    const entry: Tracked = { document, refs: 0, base: undefined, queue: Promise.resolve(), disposables: [] };
    if (document.isDirty) {
      enqueue(entry, async () => { entry.base = await readDisk(document.uri); });
    } else {
      entry.base = document.getText();
    }
    entry.disposables.push(...watchDocument(entry, key, (work) => enqueue(entry, work), deps.textMerge));
    return entry;
  };

  const stop = (key: string, entry: Tracked): void => {
    tracked.delete(key);
    entry.disposables.forEach((disposable) => disposable.dispose());
  };

  return {
    track(document) {
      const key = document.uri.toString();
      const entry = tracked.get(key) ?? start(document, key);
      tracked.set(key, entry);
      entry.refs += 1;
      let released = false;
      return new vscode.Disposable(() => {
        if (released) return;
        released = true;
        entry.refs -= 1;
        if (entry.refs === 0 && tracked.get(key) === entry) stop(key, entry);
      });
    },
    dispose() {
      for (const [key, entry] of [...tracked]) stop(key, entry);
    },
  };
}
