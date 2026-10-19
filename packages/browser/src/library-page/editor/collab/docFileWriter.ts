// Mirrors a shared project's text docs and comments into its folder, each file written 500 ms after its last change.
import {
  COMMENTS_PATH, fileText, indexFiles, isSafeSharePath, renderCommentsFile, type ILogger, type LibraryFileSystem, type ShareSession,
} from "@labshelf/core";

const LOG_MODULE = "collab.mirror";
export const DOC_WRITE_DELAY_MS = 500;

export interface DocFileWriterOptions {
  session: Pick<ShareSession, "index" | "openDoc">;
  fs: LibraryFileSystem;
  /** The project folder the share's relative paths resolve under. */
  folder: string;
  logger: ILogger;
}

export interface DocFileWriter {
  /** Stops listening and writes every pending file now. */
  close(): Promise<void>;
}

const isMissing = (error: unknown): boolean => (error as { code?: unknown }).code === "ENOENT";

export function startDocFileWriter(options: DocFileWriterOptions): DocFileWriter {
  return new DocFileMirror(options);
}

class DocFileMirror implements DocFileWriter {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly failed = new Set<string>();
  private readonly seen = new Set<string>();
  private readonly stops: (() => void)[] = [];

  constructor(private readonly options: DocFileWriterOptions) {
    const { index } = options.session;
    const files = indexFiles(index);
    const onFiles = (): void => { for (const path of files.keys()) this.track(path); };
    const onIndex = (): void => this.schedule(COMMENTS_PATH);
    files.observe(onFiles);
    index.on("update", onIndex);
    this.stops.push(() => files.unobserve(onFiles), () => index.off("update", onIndex));
    onFiles();
  }

  async close(): Promise<void> {
    this.stops.forEach((stop) => stop());
    const pending = [...this.timers.keys()];
    this.timers.forEach((timer) => clearTimeout(timer));
    for (const path of pending) { await this.write(path); }
  }

  private target(path: string): string { return `${this.options.folder}/${path}`; }

  private track(path: string): void {
    const { session, logger } = this.options;
    if (this.seen.has(path)) { return; }
    this.seen.add(path);
    if (!isSafeSharePath(path)) {
      void logger.log("WARN", LOG_MODULE, "Refused a shared path outside the project folder", { path });
      return;
    }
    if (indexFiles(session.index).get(path)?.kind !== "text") {
      void logger.log("INFO", LOG_MODULE, "Skipped a shared blob; blobs are not mirrored in the browser", { path });
      return;
    }
    const doc = session.openDoc(path);
    const onUpdate = (): void => this.schedule(path);
    doc.on("update", onUpdate);
    this.stops.push(() => doc.off("update", onUpdate));
    this.schedule(path);
  }

  /** A change also reschedules every file whose last write failed, so a passing disk error heals on any edit. */
  private schedule(path: string): void {
    for (const each of new Set([path, ...this.failed])) {
      clearTimeout(this.timers.get(each));
      this.timers.set(each, setTimeout(() => { void this.write(each); }, DOC_WRITE_DELAY_MS));
    }
  }

  private async write(path: string): Promise<void> {
    const { session, fs, logger } = this.options;
    this.timers.delete(path);
    try {
      const text = path === COMMENTS_PATH ? await this.renderComments() : fileText(session.openDoc(path)).toString();
      if (text !== undefined) { await fs.writeText(this.target(path), text); }
      this.failed.delete(path);
    } catch (error) {
      this.failed.add(path);
      await logger.error(LOG_MODULE, error, { action: "write shared file, retried on the next change", path: this.target(path) });
    }
  }

  /** @returns undefined when the file is up to date or does not parse, so it is left as it is */
  private async renderComments(): Promise<string | undefined> {
    const { session, fs, logger } = this.options;
    let existing: string | undefined;
    try {
      existing = await fs.readText(this.target(COMMENTS_PATH));
    } catch (error) {
      if (!isMissing(error)) { throw error; }
    }
    const rendered = renderCommentsFile(session.index, existing);
    if (rendered === undefined) {
      await logger.log("WARN", LOG_MODULE, "Kept a comments file that does not parse", { path: this.target(COMMENTS_PATH) });
    }
    return rendered === existing ? undefined : rendered;
  }
}
