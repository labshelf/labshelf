// Answers the editor's stat, directory listing and file reads from the project store, remembering what each read returned.
import type { BrowserProjects } from "../../storage/projects";
import { ProjectFileNotFoundError } from "../../storage/projects";
import { ProjectFileSystemError } from "./fileSystemError";
import { parseProjectUri } from "./projectUri";
import { FileType, type FileStat, type ProjectUri } from "./types";

type ReadyProject = Extract<Awaited<ReturnType<BrowserProjects["listBrowserProjects"]>>[number], { kind: "ready" }>;

const directoryStat: FileStat = { type: FileType.Directory, ctime: 0, mtime: 0, size: 0 };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function fileTarget(uri: ProjectUri) {
  const parsed = parseProjectUri(uri);
  if (parsed.kind !== "path") throw new ProjectFileSystemError("EntryIsADirectory", `${uri.path} is a folder`);
  return parsed;
}

/** @param baselines receives the bytes of every read, keyed `<projectId>/<path>`, for the write guard. */
export function createProjectReads(projects: BrowserProjects, baselines: Map<string, Uint8Array>) {
  const readyProjects = async (): Promise<ReadyProject[]> =>
    (await projects.listBrowserProjects()).filter((entry): entry is ReadyProject => entry.kind === "ready");

  const requireProject = async (projectId: string): Promise<void> => {
    if (!(await readyProjects()).some((entry) => entry.settings.id === projectId)) {
      throw new ProjectFileSystemError("EntryNotFound", `No project has the id ${projectId}`);
    }
  };

  // The store logs real failures itself; a missing file is an expected answer and stays quiet.
  const storeCall = async <T>(path: string, call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      if (error instanceof ProjectFileNotFoundError) throw new ProjectFileSystemError("EntryNotFound", `${path} does not exist`, { cause: error });
      throw new ProjectFileSystemError("Unavailable", `Could not reach ${path}: ${messageOf(error)}`, { cause: error });
    }
  };

  return {
    async stat(uri: ProjectUri): Promise<FileStat> {
      const parsed = parseProjectUri(uri);
      if (parsed.kind === "root") return directoryStat;
      if (parsed.kind === "project") { await requireProject(parsed.projectId); return directoryStat; }
      const found = await storeCall(parsed.path, () => projects.statProjectPath(parsed.projectId, parsed.path));
      if (found === undefined) throw new ProjectFileSystemError("EntryNotFound", `${parsed.path} does not exist`);
      if (found.isDirectory) return directoryStat;
      return { type: FileType.File, ctime: found.mtimeMs, mtime: found.mtimeMs, size: found.size };
    },

    async readDirectory(uri: ProjectUri): Promise<Array<[string, number]>> {
      const parsed = parseProjectUri(uri);
      if (parsed.kind === "root") return (await readyProjects()).map((entry): [string, number] => [entry.settings.id, FileType.Directory]);
      if (parsed.kind === "project") await requireProject(parsed.projectId);
      const path = parsed.kind === "project" ? "" : parsed.path;
      const entries = await storeCall(path, () => projects.listProjectDirectory(parsed.projectId, path));
      return entries.map(({ name, kind }): [string, number] => [name, kind === "directory" ? FileType.Directory : FileType.File]);
    },

    async readFile(uri: ProjectUri): Promise<Uint8Array> {
      const { projectId, path } = fileTarget(uri);
      const bytes = await storeCall(path, () => projects.readProjectFile(projectId, path));
      baselines.set(`${projectId}/${path}`, bytes);
      return bytes;
    },
  };
}
