// Remembers, per shared file, the hash of the content disk and doc last had in common, across restarts.
import { promises as fs } from "node:fs";
import { writeFileAtomic } from "../../../library/node/index.js";
import type { ILogger } from "../../../ports/index.js";

const LOG_MODULE = "collab.state";

/** A file whose disk hash differs from its known hash was edited outside the share since they last agreed. */
export class KnownFiles {
  private saving: Promise<void> = Promise.resolve();
  private dirty = false;

  private constructor(private readonly file: string, private readonly hashes: Map<string, string>, private readonly logger: ILogger) {}

  /** Loads the hashes; a missing or unreadable file starts empty, so every file is compared as new. */
  static async load(file: string, logger: ILogger): Promise<KnownFiles> {
    let hashes = new Map<string, string>();
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        hashes = new Map(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        await logger.log("WARN", LOG_MODULE, "Ignored unreadable known file hashes", { file, error: String(error) });
      }
    }
    return new KnownFiles(file, hashes, logger);
  }

  get(path: string): string | undefined { return this.hashes.get(path); }

  set(path: string, hash: string): void {
    if (this.hashes.get(path) === hash) { return; }
    this.hashes.set(path, hash);
    this.save();
  }

  delete(path: string): void {
    if (this.hashes.delete(path)) { this.save(); }
  }

  /** Waits for the last change to be on disk. */
  flush(): Promise<void> { return this.saving; }

  /** Coalesces a burst of changes into one write. */
  private save(): void {
    if (this.dirty) { return; }
    this.dirty = true;
    this.saving = this.saving.then(async () => {
      this.dirty = false;
      try {
        await writeFileAtomic(this.file, JSON.stringify(Object.fromEntries(this.hashes)));
      } catch (error) {
        await this.logger.error(LOG_MODULE, error, { file: this.file, action: "save known file hashes" });
      }
    });
  }
}
