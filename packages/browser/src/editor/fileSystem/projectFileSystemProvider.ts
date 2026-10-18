// Serves the labshelf-project: scheme to the editor from the browser project store.
import type { ILogger } from "@labshelf/core";
import type { BrowserProjects } from "../../storage/projects";
import { createFileChangeEmitter } from "./fileChangeEmitter";
import { ProjectFileSystemError } from "./fileSystemError";
import { guardedWrite } from "./guardedWrite";
import { createProjectReads, fileTarget } from "./projectReads";
import { parseProjectUri, type ParsedProjectUri } from "./projectUri";
import { FileChangeType, type FileChange, type ProjectFileSystemProvider, type ProjectUri } from "./types";

export interface ProjectFileSystemDeps {
  projects: BrowserProjects;
  logger: ILogger;
}

type EntryTarget = Extract<ParsedProjectUri, { kind: "path" }>;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A file or folder inside a project; the project folders and the project list are not the editor's to move or delete. */
function entryInside(uri: ProjectUri, action: string): EntryTarget {
  const parsed = parseProjectUri(uri);
  if (parsed.kind !== "path") throw new ProjectFileSystemError("NoPermissions", `Cannot ${action} ${uri.path}: it is a project folder`);
  return parsed;
}

interface MutationDeps {
  projects: BrowserProjects;
  baselines: Map<string, Uint8Array>;
  fire(changes: FileChange[]): void;
}

/** Renames, deletes and folder creation; the store logs its own failures, so these only translate them. */
function createProjectMutations({ projects, baselines, fire }: MutationDeps) {
  const store = async <T>(path: string, call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      throw new ProjectFileSystemError("Unavailable", `Could not change ${path}: ${messageOf(error)}`, { cause: error });
    }
  };
  const stat = (projectId: string, path: string) => store(path, () => projects.statProjectPath(projectId, path));
  // TRAP: on a case-insensitive disk a case-only target stats as the source, so only the listed names tell a second entry apart.
  const occupant = async (source: EntryTarget, target: EntryTarget) => {
    if (source.path === target.path || source.path.toLowerCase() !== target.path.toLowerCase()) return stat(target.projectId, target.path);
    const parent = target.segments.slice(0, -1).join("/");
    const names = (await store(parent, () => projects.listProjectDirectory(target.projectId, parent))).map((entry) => entry.name);
    return names.includes(target.segments.at(-1)!) ? stat(target.projectId, target.path) : undefined;
  };
  // A stale editor baseline is kept for the target on purpose: its next save then reports the outside change instead of losing it.
  const forget = ({ projectId, path }: EntryTarget): void => {
    const key = `${projectId}/${path}`;
    for (const known of [...baselines.keys()]) if (known === key || known.startsWith(`${key}/`)) baselines.delete(known);
  };

  return {
    /** A rename onto an existing file with overwrite is how a staged write lands, so it replaces the file. */
    async rename(from: ProjectUri, to: ProjectUri, { overwrite }: { overwrite: boolean }): Promise<void> {
      const source = entryInside(from, "move");
      const target = entryInside(to, "move");
      if (source.projectId !== target.projectId) throw new ProjectFileSystemError("NoPermissions", "Cannot move files between projects");
      if (await stat(source.projectId, source.path) === undefined) throw new ProjectFileSystemError("EntryNotFound", `${source.path} does not exist`);
      const existing = await occupant(source, target);
      if (existing?.isDirectory) throw new ProjectFileSystemError("EntryIsADirectory", `${target.path} is a folder`);
      if (existing && !overwrite) throw new ProjectFileSystemError("EntryExists", `${target.path} already exists`);
      await store(source.path, () => projects.renameProjectPath(source.projectId, source.path, target.path));
      forget(source);
      fire([{ type: FileChangeType.Deleted, resource: from }, { type: existing ? FileChangeType.Changed : FileChangeType.Created, resource: to }]);
    },

    async delete(uri: ProjectUri, { recursive }: { recursive: boolean }): Promise<void> {
      const target = entryInside(uri, "delete");
      const found = await stat(target.projectId, target.path);
      if (found === undefined) throw new ProjectFileSystemError("EntryNotFound", `${target.path} does not exist`);
      if (found.isDirectory && !recursive && (await store(target.path, () => projects.listProjectDirectory(target.projectId, target.path))).length > 0) {
        throw new ProjectFileSystemError("NoPermissions", `${target.path} is not empty`);
      }
      await store(target.path, () => projects.deleteProjectPath(target.projectId, target.path));
      forget(target);
      fire([{ type: FileChangeType.Deleted, resource: uri }]);
    },

    async createDirectory(uri: ProjectUri): Promise<void> {
      const parsed = parseProjectUri(uri);
      if (parsed.kind === "root") throw new ProjectFileSystemError("EntryExists", "The project list already exists");
      const path = parsed.kind === "project" ? "" : parsed.path;
      if (await stat(parsed.projectId, path) !== undefined) throw new ProjectFileSystemError("EntryExists", `${uri.path} already exists`);
      if (parsed.kind === "project") throw new ProjectFileSystemError("NoPermissions", `Cannot create the project folder ${uri.path}`);
      await store(path, () => projects.createProjectDirectory(parsed.projectId, path));
      fire([{ type: FileChangeType.Created, resource: uri }]);
    },
  };
}

export function createProjectFileSystemProvider({ projects, logger }: ProjectFileSystemDeps): ProjectFileSystemProvider {
  const changes = createFileChangeEmitter();
  /** The bytes the editor last read or saved per file; a write is checked against them. */
  const baselines = new Map<string, Uint8Array>();
  /** Writes to one file run one after another so each is checked against the previous one. */
  const queues = new Map<string, Promise<unknown>>();
  const reads = createProjectReads(projects, baselines);

  return {
    onDidChangeFile: changes.event,
    // The store cannot observe outside edits, so there is nothing to watch; a stale editor is caught when it saves.
    watch: () => ({ dispose: () => undefined }),
    stat: reads.stat,
    readDirectory: reads.readDirectory,
    readFile: reads.readFile,

    async writeFile(uri, content, { create, overwrite }) {
      const { projectId, path } = fileTarget(uri);
      const key = `${projectId}/${path}`;
      const run = async () => {
        const created = await guardedWrite(projects, logger, { projectId, path, content, create, overwrite, baseline: baselines.get(key) });
        baselines.set(key, content);
        changes.fire([{ type: created ? FileChangeType.Created : FileChangeType.Changed, resource: uri }]);
      };
      const queued = (queues.get(key) ?? Promise.resolve()).then(run, run);
      queues.set(key, queued.catch(() => undefined));
      return queued;
    },

    ...createProjectMutations({ projects, baselines, fire: changes.fire }),
  };
}
