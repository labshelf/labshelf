// Keeps a string-keyed map of a share's device-local state in one JSON file, coalescing changes into atomic writes.
import { promises as fs } from "node:fs";
import { writeFileAtomic } from "../../../library/node/index.js";
import type { ILogger } from "../../../ports/index.js";

const LOG_MODULE = "collab.state";

export interface JsonMapFileOptions<V> {
  file: string;
  /** What the map holds, for log lines. */
  label: string;
  isValue(value: unknown): value is V;
  logger: ILogger;
  /** Runs before each write, so the file never claims more than other state already on disk. */
  beforeSave?: () => Promise<void>;
}

export class JsonMapFile<V> {
  private saving: Promise<void> = Promise.resolve();
  private dirty = false;

  private constructor(private readonly options: JsonMapFileOptions<V>, private readonly entries: Map<string, V>) {}

  /** Loads the map; a missing or unreadable file starts empty. */
  static async load<V>(options: JsonMapFileOptions<V>): Promise<JsonMapFile<V>> {
    let entries = new Map<string, V>();
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(options.file, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        entries = new Map(Object.entries(parsed).filter((entry): entry is [string, V] => options.isValue(entry[1])));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        await options.logger.log("WARN", LOG_MODULE, `Ignored unreadable ${options.label}`, { file: options.file, error: String(error) });
      }
    }
    return new JsonMapFile(options, entries);
  }

  get(key: string): V | undefined { return this.entries.get(key); }

  set(key: string, value: V): void {
    if (this.entries.get(key) === value) { return; }
    this.entries.set(key, value);
    this.save();
  }

  delete(key: string): void {
    if (this.entries.delete(key)) { this.save(); }
  }

  /** Waits for the last change to be on disk. */
  flush(): Promise<void> { return this.saving; }

  /** Coalesces a burst of changes into one write. */
  private save(): void {
    if (this.dirty) { return; }
    this.dirty = true;
    const { file, label, logger, beforeSave } = this.options;
    this.saving = this.saving.then(async () => {
      await beforeSave?.();
      this.dirty = false;
      try {
        await writeFileAtomic(file, JSON.stringify(Object.fromEntries(this.entries)));
      } catch (error) {
        await logger.error(LOG_MODULE, error, { file, action: `save ${label}` });
      }
    });
  }
}
