/** Appends log entries as JSON lines to a file, rotating to <file>.1 past a size limit. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { LogEntry } from "../../model/index.js";
import { ensurePrivateDir, PRIVATE_FILE_MODE } from "../../library/node/index.js";
import type { LogSink } from "../../ports/index.js";
import { formatLogLine } from "../logger.js";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export interface FileLogSinkOptions {
  maxBytes?: number;
  /** Folders (outermost first) kept at 0o700, with the log file at 0o600; POSIX only. */
  privateDirs?: readonly string[];
}

export class FileLogSink implements LogSink {
  private readonly maxBytes: number;
  private readonly privateDirs: readonly string[];
  private modesFixed = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly file: string, options: FileLogSinkOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.privateDirs = process.platform === "win32" ? [] : (options.privateDirs ?? []);
  }

  /** Writes are queued so concurrent callers never interleave lines; a failed write rejects only its own caller. */
  append(entry: LogEntry): Promise<void> {
    const write = this.queue.then(() => this.write(entry));
    this.queue = write.catch(() => undefined);
    return write;
  }

  private async write(entry: LogEntry): Promise<void> {
    const isPrivate = this.privateDirs.length > 0;
    if (isPrivate && !this.modesFixed) for (const dir of this.privateDirs) await ensurePrivateDir(dir);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await this.rotateIfFull();
    await fs.appendFile(this.file, formatLogLine(entry), isPrivate ? { mode: PRIVATE_FILE_MODE } : undefined);
    if (isPrivate && !this.modesFixed) {
      // A log file left by an earlier run keeps its old mode until the first write fixes it.
      await fs.chmod(this.file, PRIVATE_FILE_MODE);
      this.modesFixed = true;
    }
  }

  private async rotateIfFull(): Promise<void> {
    const size = await fs.stat(this.file).then((stat) => stat.size, (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return 0;
      throw error;
    });
    if (size > this.maxBytes) {
      await fs.rename(this.file, `${this.file}.1`);
    }
  }
}
