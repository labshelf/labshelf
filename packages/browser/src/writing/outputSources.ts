// The browser's linked-output ports: this device's source folders (kept in extension storage, read and run through LabShelf Helper) and the project's files over the library.
// CONTRACT: documents/contracts/library-format.md#linked-outputs
import { formatError, posixPathOps, type ILogger, type LibraryFileSystem, type OutputProjectFiles, type OutputSourcePort } from "@labshelf/core";
import { askDialog, askInputBox } from "@labshelf/core/dom";
import { MAX_SOURCE_RUN_TIMEOUT_MS, checkSourceFolder, helperCanLinkOutputs, type ILatexHelper } from "@labshelf/core/helper";

const MODULE = "browser.outputs";
export const OUTPUT_SOURCES_KEY = "labshelf.outputSources";
const LOCK_NAME = "labshelf:output-sources";
export const NEEDS_HELPER = "Needs LabShelf Helper. Install or update it from the extension's settings page to link outputs to code.";

/** One source linked on this device: its absolute folder, this device's command, and the commands the user confirmed here. */
interface StoredOutputSource { folder: string; command?: string; confirmed: string[] }

/** The part of `bx.storage.local` the mapping needs; it never goes to sync storage, since it holds this machine's paths. */
export interface OutputSourceArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface BrowserOutputSourceDeps {
  area: OutputSourceArea;
  projectId: string;
  /** The page's shared helper client; connected on first use. */
  helper(): ILatexHelper;
  logger: ILogger;
  /** Asks whether to run `command` in `folder`; a dialog when absent. */
  confirmRun?(command: string, folder: string): Promise<boolean>;
  /** Asks for an absolute folder when the helper's machine has no folder dialog; a text box when absent. */
  promptFolder?(): Promise<string | undefined>;
  /** Serialises the read-modify-write of the mapping; a Web Lock across the profile's tabs when absent. */
  exclusive?<T>(run: () => Promise<T>): Promise<T>;
  userName?(): Promise<string | undefined>;
}

const entryKey = (projectId: string, source: string): string => `${projectId}\u0000${source}`;

/** The entry when it has the stored shape; anything else reads as not linked and is left as it is. */
function readEntry(value: unknown): StoredOutputSource | undefined {
  if (typeof value !== "object" || value === null) { return undefined; }
  const { folder, command, confirmed } = value as Record<string, unknown>;
  if (typeof folder !== "string" || folder === "") { return undefined; }
  return {
    folder,
    ...(typeof command === "string" && command !== "" ? { command } : {}),
    confirmed: Array.isArray(confirmed) ? confirmed.filter((entry): entry is string => typeof entry === "string") : [],
  };
}

const defaultConfirm = (command: string, folder: string): Promise<boolean> =>
  askDialog("Run this command?", `LabShelf Helper will run this command on this computer:\n\n${command}\n\nin the folder\n\n${folder}`, "Run");

const defaultPrompt = (): Promise<string | undefined> => askInputBox({
  title: "Folder of the code",
  prompt: "This computer has no folder dialog. Type the absolute path of the folder.",
  validate: (text) => checkSourceFolder(text.trim()) === undefined ? null : "Enter an absolute path",
});

// PLATFORM: a Web Lock is held across every tab of the profile, so two pages edit the mapping one at a time.
const webLock = <T>(run: () => Promise<T>): Promise<T> => navigator.locks.request(LOCK_NAME, { mode: "exclusive" }, run);

/** The entry with its command set (or removed); a command typed on this computer counts as confirmed here. */
const withCommand = (entry: StoredOutputSource, command: string | undefined): StoredOutputSource => ({
  folder: entry.folder, ...(command !== undefined ? { command } : {}),
  confirmed: command === undefined || entry.confirmed.includes(command) ? entry.confirmed : [...entry.confirmed, command],
});

/** The mapping of one project's sources in extension storage. */
function createMapping({ area, projectId, exclusive }: { area: OutputSourceArea; projectId: string; exclusive: <T>(run: () => Promise<T>) => Promise<T> }) {
  const readAll = async (): Promise<Record<string, unknown>> => {
    const stored = (await area.get(OUTPUT_SOURCES_KEY))[OUTPUT_SOURCES_KEY];
    return typeof stored === "object" && stored !== null && !Array.isArray(stored) ? stored as Record<string, unknown> : {};
  };
  const get = async (source: string): Promise<StoredOutputSource | undefined> => readEntry((await readAll())[entryKey(projectId, source)]);
  /** Rewrites one entry under the lock; the other entries, readable or not, stay as they are. */
  const change = (source: string, edit: (entry: StoredOutputSource | undefined) => StoredOutputSource | undefined): Promise<void> => exclusive(async () => {
    const all = await readAll();
    const key = entryKey(projectId, source);
    const next = edit(readEntry(all[key]));
    if (next === undefined) { delete all[key]; } else { all[key] = next; }
    await area.set({ [OUTPUT_SOURCES_KEY]: all });
  });
  const linked = async (source: string): Promise<StoredOutputSource> => {
    const entry = await get(source);
    if (!entry) { throw new Error(`${source} is not linked to a folder on this computer. Use Link to code.`); }
    return entry;
  };
  return { get, change, linked };
}

/** LabShelf Helper for linked outputs: connected on first use, and a folder asked of it or typed. */
function createHelperAccess(deps: BrowserOutputSourceDeps) {
  const promptFolder = deps.promptFolder ?? defaultPrompt;
  const ready = async (): Promise<ILatexHelper> => {
    const helper = deps.helper();
    const state = helper.status() ?? await helper.connect().catch((error: unknown) => {
      void deps.logger.log("WARN", MODULE, "LabShelf Helper is unreachable for linked outputs", { error: formatError(error) });
      return undefined;
    });
    if (!helperCanLinkOutputs(state)) { throw new Error(NEEDS_HELPER); }
    return helper;
  };
  const askFolder = async (helper: ILatexHelper): Promise<string | undefined> => {
    const picked = await helper.sourcePick();
    if (!picked.unavailable) { return picked.folder; }
    const typed = (await promptFolder())?.trim();
    if (!typed) { return undefined; }
    if (!(await helper.sourceInspect(typed)).exists) { throw new Error(`There is no folder at ${typed} on this computer.`); }
    return typed;
  };
  return { ready, askFolder };
}

/** This device's sources of one project: the mapping answers `status` without the helper; folders are picked, listed, read and run through it. */
export function createBrowserOutputSources(deps: BrowserOutputSourceDeps): OutputSourcePort {
  const mapping = createMapping({ area: deps.area, projectId: deps.projectId, exclusive: deps.exclusive ?? webLock });
  const { get, change, linked } = mapping;
  const { ready, askFolder } = createHelperAccess(deps);
  const confirmRun = deps.confirmRun ?? defaultConfirm;

  return {
    async status(source) {
      const entry = await get(source);
      return entry && { folder: entry.folder, ...(entry.command !== undefined ? { command: entry.command } : {}) };
    },
    async pick(source) {
      const folder = await askFolder(await ready());
      if (folder === undefined) { return undefined; }
      // Confirmations belong to a folder, so a new folder starts without any.
      await change(source, (entry) => ({ folder, ...(entry?.command !== undefined ? { command: entry.command } : {}), confirmed: entry?.folder === folder ? entry.confirmed : [] }));
      return folder;
    },
    unlink: (source) => change(source, () => undefined),
    async setCommand(source, command) {
      await linked(source);
      const text = command?.trim() || undefined;
      await change(source, (entry) => entry && withCommand(entry, text));
    },
    async list(source) {
      const { folder } = await linked(source);
      return (await ready()).sourceList(folder);
    },
    async read(source, path) {
      const { folder } = await linked(source);
      return (await ready()).sourceRead(folder, path);
    },
    async remote(source) {
      const { folder } = await linked(source);
      return (await (await ready()).sourceInspect(folder)).remote;
    },
    async run(source, command, signal) {
      const { folder, confirmed } = await linked(source);
      const helper = await ready();
      if (!confirmed.includes(command)) {
        if (!(await confirmRun(command, folder))) { return { status: "declined" }; }
        await change(source, (entry) => entry && entry.folder === folder && !entry.confirmed.includes(command) ? { ...entry, confirmed: [...entry.confirmed, command] } : entry);
      }
      return helper.sourceRun({ folder, command, timeoutMs: MAX_SOURCE_RUN_TIMEOUT_MS }, signal);
    },
    ...(deps.userName ? { userName: deps.userName } : {}),
  };
}

/** The project's files under the library folder `projectFolder`; writes are atomic and create their folders. */
export function createLibraryOutputFiles(fs: Pick<LibraryFileSystem, "stat" | "readFile" | "writeFile" | "ensureDir">, projectFolder: string): OutputProjectFiles {
  const full = (path: string): string => posixPathOps.join(projectFolder, path);
  return {
    async readBytes(path) {
      const target = full(path);
      const stat = await fs.stat(target);
      return stat && !stat.isDirectory ? await fs.readFile(target) : undefined;
    },
    async writeBytes(path, bytes) {
      const target = full(path);
      await fs.ensureDir(posixPathOps.dirname(target));
      await fs.writeFile(target, bytes);
    },
  };
}
