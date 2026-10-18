// Holds a project's files in memory for the Typst compiler, which reads files synchronously in the middle of a compile.
import type { TypstFileAccess } from "@labshelf/core/typst";
import { ProjectFileNotFoundError, type BrowserProjects } from "../../storage/projects";

/** The compiler path of the project folder; files sit under it at their project-relative paths. */
export const COMPILER_ROOT = "/project";

export const compilerPath = (relative: string): string => `${COMPILER_ROOT}/${relative}`;

export interface ProjectSnapshot {
  access: TypstFileAccess;
  /** Reads one file again after it changed on disk, or forgets it when it is gone. */
  refresh(relative: string): Promise<void>;
}

async function collect(projects: BrowserProjects, projectId: string, folder: string, into: Map<string, Uint8Array>): Promise<void> {
  const entries = await projects.listProjectDirectory(projectId, folder);
  await Promise.all(entries.map(async ({ name, kind }) => {
    const relative = folder === "" ? name : `${folder}/${name}`;
    if (kind === "directory") await collect(projects, projectId, relative, into);
    else into.set(compilerPath(relative), await projects.readProjectFile(projectId, relative));
  }));
}

export async function loadProjectSnapshot(projects: BrowserProjects, projectId: string): Promise<ProjectSnapshot> {
  const files = new Map<string, Uint8Array>();
  await collect(projects, projectId, "", files);
  const versions = new Map<string, Date>();
  const isFolder = (path: string): boolean => [...files.keys()].some((file) => file.startsWith(`${path}/`));
  return {
    access: {
      getMTime: (path) => (files.has(path) ? versions.get(path) ?? new Date(0) : undefined),
      isFile: (path) => (files.has(path) ? true : isFolder(path) ? false : undefined),
      getRealPath: (path) => path,
      readAll: (path) => files.get(path),
    },
    async refresh(relative) {
      const path = compilerPath(relative);
      versions.set(path, new Date());
      try {
        files.set(path, await projects.readProjectFile(projectId, relative));
      } catch (error) {
        // A staged write renames its temporary file away, and a deleted file is gone: either way the compiler must not see it.
        if (!(error instanceof ProjectFileNotFoundError)) throw error;
        files.delete(path);
      }
    },
  };
}
