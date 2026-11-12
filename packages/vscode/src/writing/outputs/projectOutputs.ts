// One project's linked outputs on this machine; tells a panel or a text editor, debounced, that a project's linked outputs may have changed: a linked source file, a copy under outputs/, or .labshelf/outputs.json.
// CONTRACT: documents/contracts/library-format.md#linked-outputs
import * as vscode from "vscode";

import { OUTPUTS_FILE_PATH, OUTPUTS_FOLDER, createDebouncer, parseOutputsFile, type LibraryFileSystem, type OutputProjectFiles, type OutputSourcePort } from "@labshelf/core";

/** The source ports of every project on this machine; built by the desktop platform, absent on the web. */
export interface OutputSourceHost {
  /** The port of one project's sources, keyed by the project's id. */
  portFor(projectId: string): OutputSourcePort;
  /** Fires when a source of any project is linked, unlinked or gets a new command here. */
  onDidChange: vscode.Event<void>;
  /** Shows the runs' output, for a failed run's "Show Output". */
  showOutput?(): void;
}

/** The segments of a project-relative POSIX path; an absolute path, a backslash or one that climbs out of the folder throws. */
function projectSegments(path: string): string[] {
  if (path.startsWith("/") || path.includes("\\") || /^[A-Za-z]:/.test(path)) { throw new Error(`${path} is outside the project`); }
  const segments = path.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.includes("..")) { throw new Error(`${path} is outside the project`); }
  return segments;
}

/** The project's files over the library disk (whose writes are atomic), confined to the project folder. */
function createOutputProjectFiles(fs: Pick<LibraryFileSystem, "readFile" | "writeFile" | "exists" | "ensureDir">, join: (...parts: string[]) => string, projectFolder: string): OutputProjectFiles {
  const target = (path: string): { file: string; folder: string } => {
    const segments = projectSegments(path);
    return { file: join(projectFolder, ...segments), folder: join(projectFolder, ...segments.slice(0, -1)) };
  };
  return {
    async readBytes(path) {
      const { file } = target(path);
      if (!await fs.exists(file)) { return undefined; }
      return await fs.readFile(file);
    },
    async writeBytes(path, bytes) {
      const { file, folder } = target(path);
      await fs.ensureDir(folder);
      await fs.writeFile(file, bytes);
    },
  };
}

/** A burst of writes (a run that rewrites many outputs) reaches the listener once, this long after the last. */
const OUTPUTS_CHANGE_DELAY_MS = 300;

interface OutputsWatchDeps {
  projectFolder: string;
  files: OutputProjectFiles;
  sources: OutputSourcePort;
  /** Fires when this machine links, unlinks or re-commands a source, so the watched folders follow. */
  onDidChangeSources: vscode.Event<void>;
  onChange(): void;
}

/** One watcher per linked path of each source linked here, rebuilt when the outputs file or the mapping changes. */
async function watchSources({ files, sources }: OutputsWatchDeps, onUri: () => void): Promise<vscode.Disposable[]> {
  const bytes = await files.readBytes(OUTPUTS_FILE_PATH).catch(() => undefined);
  const { file } = parseOutputsFile(bytes === undefined ? undefined : new TextDecoder("utf-8").decode(bytes));
  const watchers: vscode.Disposable[] = [];
  for (const source of new Set(file.links.map((link) => link.source))) {
    const folder = (await sources.status(source).catch(() => undefined))?.folder;
    if (folder === undefined) { continue; }
    for (const link of file.links.filter((each) => each.source === source)) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(folder), link.path));
      watchers.push(watcher, watcher.onDidChange(onUri), watcher.onDidCreate(onUri), watcher.onDidDelete(onUri));
    }
  }
  return watchers;
}

function watchProjectOutputs(deps: OutputsWatchDeps): vscode.Disposable {
  const notify = createDebouncer(() => deps.onChange(), OUTPUTS_CHANGE_DELAY_MS);
  const onUri = (): void => notify.call();
  let disposed = false;
  let sourceWatchers: vscode.Disposable[] = [];
  let generation = 0;
  const rewatch = (): void => {
    const mine = ++generation;
    void watchSources(deps, onUri).then((next) => {
      if (disposed || mine !== generation) { for (const each of next) { each.dispose(); } return; }
      for (const each of sourceWatchers) { each.dispose(); }
      sourceWatchers = next;
    }, () => undefined);
  };
  const root = vscode.Uri.file(deps.projectFolder);
  const copies = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, `${OUTPUTS_FOLDER}/**`));
  const outputsFile = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, OUTPUTS_FILE_PATH));
  const onOutputsFile = (): void => { rewatch(); notify.call(); };
  rewatch();
  return vscode.Disposable.from(
    copies, copies.onDidChange(onUri), copies.onDidCreate(onUri), copies.onDidDelete(onUri),
    outputsFile, outputsFile.onDidChange(onOutputsFile), outputsFile.onDidCreate(onOutputsFile), outputsFile.onDidDelete(onOutputsFile),
    deps.onDidChangeSources(onOutputsFile),
    { dispose: () => { disposed = true; notify.cancel(); for (const each of sourceWatchers) { each.dispose(); } sourceWatchers = []; } },
  );
}

/** One project's linked outputs on this machine: its files, its sources and a watcher of both. */
export interface ProjectOutputs {
  files: OutputProjectFiles;
  sources: OutputSourcePort;
  /** Calls `onChange`, debounced, after a linked source file, a copy or the outputs file changed, until disposed. */
  watch(onChange: () => void): vscode.Disposable;
}

export function openProjectOutputs(
  host: OutputSourceHost, project: { folder: string; projectId: string }, fs: Pick<LibraryFileSystem, "readFile" | "writeFile" | "exists" | "ensureDir">, join: (...parts: string[]) => string,
): ProjectOutputs {
  const files = createOutputProjectFiles(fs, join, project.folder);
  const sources = host.portFor(project.projectId);
  return { files, sources, watch: (onChange) => watchProjectOutputs({ projectFolder: project.folder, files, sources, onDidChangeSources: host.onDidChange, onChange }) };
}
