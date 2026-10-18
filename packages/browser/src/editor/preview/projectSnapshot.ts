// Holds a project's files in memory for the Typst compiler, which reads files synchronously in the middle of a compile.
import type { TypstFileAccess } from "@labshelf/core/typst";
import type { BrowserProjects } from "../../storage/projects";

/** The compiler path of the project folder; files sit under it at their project-relative paths. */
export const COMPILER_ROOT = "/project";

export const compilerPath = (relative: string): string => `${COMPILER_ROOT}/${relative}`;

export interface ProjectSnapshot {
  access: TypstFileAccess;
  /** Reads one file again after it changed on disk. */
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
      files.set(compilerPath(relative), await projects.readProjectFile(projectId, relative));
      versions.set(compilerPath(relative), new Date());
    },
  };
}
