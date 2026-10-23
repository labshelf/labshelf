// Keeps project ancestors and the newest twenty version texts outside the synced library.
import type { PathOps } from "../../library/mutations/index.js";
import type { LibraryFileSystem } from "../../ports/index.js";
import { isProjectPath } from "../history/index.js";
import { parseVersionJournal, textHash, type VersionJournal } from "./versionJournal.js";
import type { IProjectVersionStore } from "./projectVersionStore.js";

/**
 * @throws unless the value is a "/"-separated path inside its folder, and one segment for a project id:
 * ids and paths come from disk and sync. A backslash is refused so that `a\b` and `a/b` never share a base.
 */
function safeSegments(label: string, value: string, singleSegment: boolean): string[] {
  if (!isProjectPath(value) || /[\\\0]/.test(value) || (singleSegment && value.includes("/"))) {
    throw new Error(`Invalid merge base ${label}: ${JSON.stringify(value)}`);
  }
  return value.split("/");
}

const queued = new Map<string, Promise<void>>();

export class FileProjectVersionStore implements IProjectVersionStore {
  constructor(
    private readonly fs: LibraryFileSystem,
    private readonly paths: PathOps,
    private readonly baseDir: string,
  ) {}

  private fileFor(projectId: string, relativePath: string): string {
    if (relativePath.split('/').includes('.versions')) throw new Error('Invalid merge base path: reserved version journal folder');
    return this.paths.join(
      this.baseDir, ...safeSegments("project id", projectId, true), ...safeSegments("path", relativePath, false),
    );
  }

  async read(projectId: string, relativePath: string): Promise<string | undefined> {
    const file = this.fileFor(projectId, relativePath);
    try {
      return await this.fs.readText(file);
    } catch (error) {
      if ((error as { code?: unknown }).code === "ENOENT") { return undefined; }
      throw new Error(`Cannot read merge base ${file}`, { cause: error });
    }
  }

  private journalFileFor(projectId: string, relativePath: string): string {
    this.fileFor(projectId, relativePath);
    return this.paths.join(this.baseDir, projectId, '.versions', ...relativePath.split('/'));
  }

  private async journal(projectId: string, relativePath: string): Promise<VersionJournal> {
    const file = this.journalFileFor(projectId, relativePath);
    try { return await parseVersionJournal(await this.fs.readText(file)); }
    catch (error) {
      if ((error as { code?: unknown }).code === "ENOENT") { return { versions: [] }; }
      throw new Error(`Cannot read project versions ${file}`, { cause: error });
    }
  }

  async latest(projectId: string, relativePath: string): Promise<string | undefined> {
    const journal = await this.journal(projectId, relativePath);
    return journal.versions.find(entry => entry.hash === journal.known)?.text;
  }

  async version(projectId: string, relativePath: string, hash: string): Promise<string | undefined> {
    return (await this.journal(projectId, relativePath)).versions.find(entry => entry.hash === hash)?.text;
  }

  private mutate(projectId: string, relativePath: string, update: (journal: VersionJournal) => Promise<void>): Promise<void> {
    const file = this.journalFileFor(projectId, relativePath);
    const run = (queued.get(file) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const journal = await this.journal(projectId, relativePath);
      await update(journal);
      await this.fs.writeText(file, JSON.stringify(journal));
    });
    queued.set(file, run);
    void run.finally(() => { if (queued.get(file) === run) queued.delete(file); }).catch(() => undefined);
    return run;
  }

  private saveVersion(projectId: string, relativePath: string, text: string, known: boolean): Promise<void> {
    return this.mutate(projectId, relativePath, async journal => {
      const hash = await textHash(text);
      journal.versions = [...journal.versions.filter(entry => entry.hash !== hash), { hash, text }];
      if (known) journal.known = hash;
      while (journal.versions.length > 20) journal.versions.splice(journal.versions.findIndex(entry => entry.hash !== journal.known), 1);
    });
  }

  retain(projectId: string, relativePath: string, text: string): Promise<void> {
    return this.saveVersion(projectId, relativePath, text, false);
  }

  remember(projectId: string, relativePath: string, text: string): Promise<void> {
    return this.saveVersion(projectId, relativePath, text, true);
  }

  async pending(projectId: string, relativePath: string): Promise<string | undefined> {
    return (await this.journal(projectId, relativePath)).pending;
  }

  setPending(projectId: string, relativePath: string, copy: string | undefined): Promise<void> {
    if (copy !== undefined && (!copy || /[/\\\0]/.test(copy) || copy === '.' || copy === '..')) throw new Error('Invalid pending conflict path');
    return this.mutate(projectId, relativePath, async journal => {
      if (copy === undefined) delete journal.pending;
      else journal.pending = copy;
    });
  }

  async write(projectId: string, relativePath: string, text: string): Promise<void> {
    const file = this.fileFor(projectId, relativePath);
    try {
      await this.fs.writeText(file, text);
      if (await this.latest(projectId, relativePath) === undefined) await this.remember(projectId, relativePath, text);
    } catch (error) {
      throw new Error(`Cannot write merge base ${file}`, { cause: error });
    }
  }
}
