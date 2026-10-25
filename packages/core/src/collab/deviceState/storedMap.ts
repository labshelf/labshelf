// Keeps a string-keyed map of a share's device-local state, coalescing changes into whole-map saves through the storage port.
import type { ILogger } from "../../ports/index.js";
import type { CollabDeviceStateStorage, DeviceStateMapName } from "./collabStorage.js";

const LOG_MODULE = "collab.state";

export interface StoredMapOptions<V> {
  storage: CollabDeviceStateStorage;
  name: DeviceStateMapName;
  /** What the map holds, for log lines and errors. */
  label: string;
  isValue(value: unknown): value is V;
  logger: ILogger;
  /** Resolves false while a save would claim more than other state already stored; the map then stays unsaved. */
  maySave?: () => Promise<boolean>;
}

export class StoredMap<V> {
  private saving: Promise<void> = Promise.resolve();
  private queued = false;
  private changes = 0;
  private savedChanges = 0;

  private constructor(private readonly options: StoredMapOptions<V>, private readonly entries: Map<string, V>) {}

  /** Loads the map; a missing or unreadable one starts empty. */
  static async load<V>(options: StoredMapOptions<V>): Promise<StoredMap<V>> {
    const { storage, name, label, isValue, logger } = options;
    let entries = new Map<string, V>();
    try {
      const stored = await storage.loadMap(name);
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        entries = new Map(Object.entries(stored).filter((entry): entry is [string, V] => isValue(entry[1])));
      } else if (stored !== undefined) {
        await logger.log("WARN", LOG_MODULE, `Ignored ${label} that are not a map`, { name });
      }
    } catch (error) {
      await logger.log("WARN", LOG_MODULE, `Ignored unreadable ${label}`, { name, error: String(error) });
    }
    return new StoredMap(options, entries);
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

  /** Saves any change not stored yet; rejects when a change stays unsaved. */
  async flush(): Promise<void> {
    if (this.savedChanges < this.changes) { this.queue(); }
    await this.saving;
    if (this.savedChanges < this.changes) { throw new Error(`The ${this.options.label} are not stored`); }
  }

  private save(): void {
    this.changes += 1;
    this.queue();
  }

  /** Coalesces a burst of changes into one save. */
  private queue(): void {
    if (this.queued) { return; }
    this.queued = true;
    const { storage, name, label, logger, maySave } = this.options;
    this.saving = this.saving.then(async () => {
      const allowed = await (maySave?.() ?? Promise.resolve(true));
      this.queued = false;
      if (!allowed) {
        await logger.log("WARN", LOG_MODULE, `Held back saving the ${label} while doc updates are not stored`, { name });
        return;
      }
      const covered = this.changes;
      try {
        await storage.saveMap(name, Object.fromEntries(this.entries));
        this.savedChanges = Math.max(this.savedChanges, covered);
      } catch (error) {
        await logger.error(LOG_MODULE, error, { name, action: `save ${label}` });
      }
    });
  }
}
