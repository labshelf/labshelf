// Reads and changes the personal Home desk (home.json) through the library file system, one serial read-modify-write at a time, notifying listeners after each change.
import { createListeners } from "../events/index.js";
import { formatError } from "../errors/index.js";
import { createLibraryLayout } from "../library/index.js";
import type { ILogger, LibraryFileSystem } from "../ports/index.js";
import type { PathOps } from "../path/index.js";
import {
  EMPTY_HOME, parseHomeFile, serializeHomeFile, withHomeNote, withHomePin, withHomeTask, withoutHomeEntry,
  type HomeFile, type HomePin, type HomeTaskInput,
} from "./homeFile.js";

export interface HomeStoreOptions {
  /** The library folder. */
  readonly root: string;
  readonly fs: LibraryFileSystem;
  readonly paths: Pick<PathOps, "join">;
  readonly logger: ILogger;
}

const MODULE = "spaces/home";

export class HomeStore {
  private readonly path: string;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly listeners = createListeners();

  constructor(private readonly options: HomeStoreOptions) {
    this.path = createLibraryLayout(options.root, (base, ...segments) => options.paths.join(base, ...segments)).homeFilePath();
  }

  /** The desk on disk; a file that cannot be read is an empty, read-only desk, so it is never overwritten. */
  async read(): Promise<HomeFile> {
    const { fs, logger } = this.options;
    try {
      return parseHomeFile(await fs.exists(this.path) ? await fs.readText(this.path) : undefined);
    } catch (error) {
      const reason = `home.json could not be read: ${formatError(error)}`;
      await logger.log("WARN", MODULE, "Home is unreadable", { path: this.path, reason });
      return { ...EMPTY_HOME, readOnlyReason: reason };
    }
  }

  onChange(listener: () => void): () => void { return this.listeners.add(listener); }

  /** Tells the listeners the file changed outside this store, such as by sync. */
  changed(): void { this.listeners.emit(); }

  pin(pin: HomePin, note?: string): Promise<void> { return this.change("Pinned to Home", (home) => withHomePin(home, pin, note)); }
  setNote(id: string, note?: string): Promise<void> { return this.change("Reminder changed", (home) => withHomeNote(home, id, note)); }
  unpin(id: string): Promise<void> { return this.change("Unpinned from Home", (home) => withoutHomeEntry(home, id)); }
  completeTask(id: string): Promise<void> { return this.change("Task completed", (home) => withoutHomeEntry(home, id)); }
  async addTask(input: HomeTaskInput): Promise<string> {
    let id = "";
    await this.change("Task added", (home) => { const added = withHomeTask(home, input); id = added.id; return added.home; });
    return id;
  }

  /** A failed write settles its slot, so the writes queued after it still run. */
  private change(action: string, apply: (home: HomeFile) => HomeFile): Promise<void> {
    const run = this.tail.then(async () => {
      const home = await this.read();
      if (home.readOnlyReason !== undefined) { throw new Error(home.readOnlyReason); }
      const next = apply(home);
      if (next === home) { return; }
      try {
        await this.options.fs.writeText(this.path, serializeHomeFile(next));
      } catch (error) {
        await this.options.logger.log("ERROR", MODULE, `${action} failed`, { path: this.path, error: formatError(error) });
        throw new Error(`${action} failed for ${this.path}: ${formatError(error)}`, { cause: error });
      }
      await this.options.logger.log("INFO", MODULE, action, { path: this.path });
      this.listeners.emit();
    });
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}
