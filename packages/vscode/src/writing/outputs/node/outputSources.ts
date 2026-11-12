// This machine's OutputSourcePort: the folder of each project's source kept in globalState, the folder dialog, and runs confirmed per exact command, shown in the "LabShelf Outputs" channel.
// CONTRACT: documents/contracts/library-format.md#linked-outputs
import * as vscode from "vscode";

import { listSourceFolder, readGitRemote, readSourceFile, runSourceCommand } from "@labshelf/core/node";
import type { ILogger, OutputRunResult, OutputSourcePort } from "@labshelf/core";
import { askFigureCommand, rememberFigureCommand } from "../../projects/projectFigures.js";
import type { OutputSourceHost } from "../projectOutputs.js";

/** globalState key of the mapping `${projectId}\u0000${source}` → this machine's folder and command. */
export const OUTPUT_SOURCES_KEY = "labshelf.writing.outputSources";
const MODULE = "writing/outputs";

interface SourceEntry { folder: string; command?: string }
type SourceMap = Record<string, SourceEntry>;

export interface OutputSourceHostDeps {
  /** Machine-local: the mapping lives in globalState and the confirmed commands in workspaceState, as figure commands do. */
  globalState: Pick<vscode.Memento, "get" | "update">;
  workspaceState: vscode.Memento;
  output: Pick<vscode.OutputChannel, "append" | "appendLine"> & Partial<Pick<vscode.OutputChannel, "show">>;
  logger: ILogger;
}

const keyOf = (projectId: string, source: string): string => `${projectId}\u0000${source}`;

function isEntry(value: unknown): value is SourceEntry {
  if (typeof value !== "object" || value === null) { return false; }
  const { folder, command } = value as Record<string, unknown>;
  return typeof folder === "string" && folder !== "" && (command === undefined || typeof command === "string");
}

/** Runs the confirmed command in the folder with a cancellable progress notification and the output in the channel. */
function runWithProgress(deps: OutputSourceHostDeps, source: string, folder: string, command: string, signal: AbortSignal): Thenable<OutputRunResult> {
  deps.output.appendLine(`$ ${command}\n  in ${folder}`);
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Running ${source}`, cancellable: true }, (_progress, token) => {
    const abort = new AbortController();
    const stop = (): void => abort.abort();
    signal.addEventListener("abort", stop);
    const cancel = token.onCancellationRequested(stop);
    if (signal.aborted) { abort.abort(); }
    return runSourceCommand({ folder, command, signal: abort.signal, onOutput: (chunk) => deps.output.append(chunk) }).finally(() => {
      cancel.dispose();
      signal.removeEventListener("abort", stop);
    });
  });
}

interface MapStore {
  readMap(): SourceMap;
  change(edit: (map: SourceMap) => void): Promise<void>;
}

/** The mapping of linked sources kept in globalState. */
function createMapStore(deps: OutputSourceHostDeps, changed: vscode.EventEmitter<void>): MapStore {
  const readMap = (): SourceMap => {
    const stored = deps.globalState.get<Record<string, unknown>>(OUTPUT_SOURCES_KEY) ?? {};
    return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, SourceEntry] => isEntry(entry[1])));
  };
  // Every change of the mapping rereads it first and writes in turn, so two quick changes never lose one.
  let writes: Promise<unknown> = Promise.resolve();
  const change = (edit: (map: SourceMap) => void): Promise<void> => {
    const next = writes.then(async () => {
      const raw = { ...deps.globalState.get<Record<string, unknown>>(OUTPUT_SOURCES_KEY) ?? {} } as SourceMap;
      edit(raw);
      await deps.globalState.update(OUTPUT_SOURCES_KEY, raw);
      changed.fire();
    });
    writes = next.catch(() => undefined);
    return next;
  };
  return { readMap, change };
}

function createPort(deps: OutputSourceHostDeps, { readMap, change }: MapStore, projectId: string): OutputSourcePort {
  const entryOf = (source: string): SourceEntry | undefined => readMap()[keyOf(projectId, source)];
  const folderOf = (source: string): string => {
    const entry = entryOf(source);
    if (!entry) { throw new Error(`${source} is not linked to code on this computer.`); }
    return entry.folder;
  };
  return {
    status: async (source) => {
      const entry = entryOf(source);
      return entry && { folder: entry.folder, ...(entry.command !== undefined ? { command: entry.command } : {}) };
    },
    async pick(source) {
      const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: "Link Folder", title: `Folder of the code of ${source}` });
      const folder = picked?.[0]?.fsPath;
      if (folder === undefined) { return undefined; }
      await change((map) => { map[keyOf(projectId, source)] = { ...map[keyOf(projectId, source)], folder }; });
      await deps.logger.log("INFO", MODULE, "output source linked", { project: projectId, source });
      return folder;
    },
    async unlink(source) {
      await change((map) => { delete map[keyOf(projectId, source)]; });
    },
    async setCommand(source, command) {
      const folder = folderOf(source);
      const trimmed = command?.trim() || undefined;
      // A command typed on this machine counts as confirmed for its folder.
      if (trimmed !== undefined) { await rememberFigureCommand(deps.workspaceState, folder, trimmed); }
      await change((map) => {
        const entry = map[keyOf(projectId, source)];
        if (!entry) { return; }
        if (trimmed === undefined) { delete entry.command; } else { entry.command = trimmed; }
      });
    },
    list: async (source) => await listSourceFolder(folderOf(source)),
    read: async (source, path) => await readSourceFile(folderOf(source), path),
    remote: async (source) => await readGitRemote(folderOf(source)),
    async run(source, command, signal) {
      const folder = folderOf(source);
      if (!await askFigureCommand(deps.workspaceState, folder, command, "the project's linked outputs")) { return { status: "declined" }; }
      const started = Date.now();
      const result = await runWithProgress(deps, source, folder, command, signal);
      await deps.logger.log("INFO", MODULE, "source command ended", {
        project: projectId, source, status: result.status, ...(result.status === "finished" ? { exitCode: result.code } : {}), durationMs: Date.now() - started,
      });
      return result;
    },
  };
}

export function createOutputSourceHost(deps: OutputSourceHostDeps): OutputSourceHost & vscode.Disposable {
  const changed = new vscode.EventEmitter<void>();
  const store = createMapStore(deps, changed);
  return { portFor: (projectId) => createPort(deps, store, projectId), onDidChange: changed.event, showOutput: () => deps.output.show?.(true), dispose: () => changed.dispose() };
}
