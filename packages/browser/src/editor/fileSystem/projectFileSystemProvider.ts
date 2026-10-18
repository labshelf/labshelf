// Serves the labshelf-project: scheme to the editor from the browser project store.
import type { ILogger } from "@labshelf/core";
import type { BrowserProjects } from "../../storage/projects";
import { createFileChangeEmitter } from "./fileChangeEmitter";
import { ProjectFileSystemError } from "./fileSystemError";
import { guardedWrite } from "./guardedWrite";
import { createProjectReads, fileTarget } from "./projectReads";
import { FileChangeType, type ProjectFileSystemProvider } from "./types";

export interface ProjectFileSystemDeps {
  projects: BrowserProjects;
  logger: ILogger;
}

function noPermissions(action: string): ProjectFileSystemError {
  return new ProjectFileSystemError("NoPermissions", `The project store cannot ${action}`);
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

    delete: () => Promise.reject(noPermissions("delete files")),
    rename: () => Promise.reject(noPermissions("rename files")),
    createDirectory: () => Promise.reject(noPermissions("create empty folders")),
  };
}
