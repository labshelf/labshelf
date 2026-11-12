/** A linked source folder on this machine: its output files listed, one read with the path confined to the folder, its git remote, its command run through the shell, and the system dialog that picks it. */
// CONTRACT: documents/contracts/library-format.md#linked-outputs
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { errorCode } from "../../../errors/index.js";
import { checkRelativePath, isInside } from "../../../path/index.js";
import { nodePathOps } from "../../../path/node/index.js";
import { BuildCancelled, runCancellable } from "../../../latex/node/index.js";
import type { FigureRunResult } from "../../figures/index.js";
import { parseGitRemote } from "../gitRemote.js";

export const MAX_SOURCE_FILES = 5000;

const SKIPPED_FOLDERS = new Set(["node_modules", "venv", "__pycache__"]);

/** The files of the folder as POSIX paths relative to it, sorted; hidden entries, .git, node_modules, venvs and __pycache__ are skipped, at most 5000. */
export async function listSourceFolder(folder: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (relative: string): Promise<void> => {
    const entries = await fs.readdir(path.join(folder, relative), { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (found.length >= MAX_SOURCE_FILES) { return; }
      if (entry.name.startsWith(".")) { continue; }
      const rel = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory() && !SKIPPED_FOLDERS.has(entry.name)) { await walk(rel); } else if (entry.isFile()) { found.push(rel); }
    }
  };
  await walk("");
  return found;
}

/** The bytes of a file named relative to the folder; undefined when absent. Throws for a path that could leave the folder, also through a symbolic link. */
export async function readSourceFile(folder: string, relative: string): Promise<Uint8Array | undefined> {
  const problem = checkRelativePath(relative);
  if (problem !== undefined) { throw new Error(`${relative} ${problem}.`); }
  const root = await fs.realpath(folder);
  let target: string;
  try {
    target = await fs.realpath(path.join(root, ...relative.split("/")));
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") { return undefined; }
    throw error;
  }
  if (!isInside(nodePathOps, root, target)) { throw new Error(`${relative} is outside the source folder.`); }
  if (!(await fs.stat(target)).isFile()) { return undefined; }
  return new Uint8Array(await fs.readFile(target));
}

const readOptional = (file: string): Promise<string | undefined> => fs.readFile(file, "utf8").catch(() => undefined);

/** The git remote of the folder: `.git/config`, or the config a `.git` file's `gitdir:` (a worktree's `commondir`) leads to. */
export async function readGitRemote(folder: string): Promise<string | undefined> {
  const dotGit = path.join(folder, ".git");
  const stat = await fs.stat(dotGit).catch(() => undefined);
  if (!stat) { return undefined; }
  let gitDir = dotGit;
  if (stat.isFile()) {
    const pointer = /^gitdir:\s*(.+)$/m.exec(await readOptional(dotGit) ?? "")?.[1]?.trim();
    if (pointer === undefined) { return undefined; }
    gitDir = path.resolve(folder, pointer);
    const common = (await readOptional(path.join(gitDir, "commondir")))?.trim();
    if (common) { gitDir = path.resolve(gitDir, common); }
  }
  const config = await readOptional(path.join(gitDir, "config"));
  return config === undefined ? undefined : parseGitRemote(config);
}

// --- The command ---

export interface SourceCommandRun {
  folder: string;
  command: string;
  signal: AbortSignal;
  onOutput?: (chunk: string) => void;
  /** Ends the run after this long; no limit when absent. */
  timeoutMs?: number;
}

/** Rejects when the shell cannot start or the run times out; a command that exits with an error code is a result. */
export async function runSourceCommand({ folder, command, signal, onOutput, timeoutMs }: SourceCommandRun): Promise<FigureRunResult> {
  try {
    const outcome = await runCancellable(command, [], folder, signal, { shell: true, ...(onOutput ? { onOutput } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
    return { status: "finished", code: outcome.code, output: outcome.output };
  } catch (error) {
    if (error instanceof BuildCancelled) { return { status: "cancelled" }; }
    throw error;
  }
}

// --- The folder dialog ---

interface Exec { code: number | null; stdout: string; missing: boolean }

function exec(file: string, args: string[]): Promise<Exec> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      const missing = errorCode(error) === "ENOENT";
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout), missing });
    });
  });
}

const WINDOWS_SCRIPT = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
  "$dialog.Description = 'Choose the folder of the code'",
  "if ($dialog.ShowDialog() -eq 'OK') { [Console]::Out.Write($dialog.SelectedPath) }",
].join("; ");

/** The folder the user picks; undefined when cancelled. Throws "no folder dialog" when the system has none. */
export async function pickFolderNative(prompt = "Choose the folder of the code"): Promise<string | undefined> {
  const attempts: Array<[string, string[]]> = process.platform === "darwin"
    ? [["osascript", ["-e", `POSIX path of (choose folder with prompt ${JSON.stringify(prompt)})`]]]
    : process.platform === "win32"
      ? [["powershell.exe", ["-NoProfile", "-STA", "-Command", WINDOWS_SCRIPT]]]
      : [["zenity", ["--file-selection", "--directory", `--title=${prompt}`]], ["kdialog", ["--getexistingdirectory", "."]]];
  for (const [file, args] of attempts) {
    const result = await exec(file, args);
    if (result.missing) { continue; }
    const folder = result.stdout.trim();
    // macOS answers a folder with a trailing slash.
    return result.code === 0 && folder !== "" ? folder.replace(/(?<=.)\/$/, "") : undefined;
  }
  throw new Error("no folder dialog");
}
