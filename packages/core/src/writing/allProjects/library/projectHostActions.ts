// Runs the All projects page's build, preview, log, new file and target actions on any project.
import type { ProjectSubmission } from "../../project/index.js";
import type { ProjectLibraryPort } from "../projectLibraryPort.js";
import type { ProjectLibraryDeps, ReadyProject } from "./projectLibraryDeps.js";

export interface ProjectHostActionDeps extends Pick<ProjectLibraryDeps, "fs" | "paths" | "host" | "locate"> {
  /** Throws when the id is not a readable project of the library. */
  findReady(id: string): ReadyProject;
  openFile(id: string, file: string): Promise<void>;
  /** Writes the patch to the project's labshelf.yaml and reloads the project list. */
  edit(id: string, patch: { target: ProjectSubmission | null }): Promise<void>;
}

type HostActions = Pick<ProjectLibraryPort, "build" | "preview" | "openLog" | "createFile" | "setTarget">;

export function createProjectHostActions(deps: ProjectHostActionDeps): HostActions {
  const { host, locate, paths, fs } = deps;
  const mainOf = (project: ReadyProject): string => {
    if (!project.main) { throw new Error(`${project.folder} has no main file`); }
    return project.main;
  };

  return {
    async build(id) {
      const project = deps.findReady(id);
      await host.build(project, mainOf(project));
    },
    preview: (id) => host.preview(deps.findReady(id)),
    async openLog(id) {
      const project = deps.findReady(id);
      const log = await locate.rawLog(project, mainOf(project));
      if (!log) { throw new Error(`No build log yet for ${project.folder}`); }
      await host.openLog(log);
    },
    async createFile(id, file) {
      const { folder } = deps.findReady(id);
      const target = paths.resolve(folder, file);
      // The page's parser already rejects these paths; the resolved path is checked again because it is what gets written.
      const inside = paths.relative(folder, target);
      if (!inside || inside.startsWith("..") || paths.isAbsolute(inside)) { throw new Error(`${file} is outside ${folder}`); }
      // TRAP: the port has no exclusive create, so a file that appears between this check and the write is overwritten.
      if (await fs.stat(target)) { throw new Error(`${file} already exists in ${folder}`); }
      try {
        await fs.ensureDir(paths.dirname(target));
        await fs.writeFile(target, new Uint8Array());
      } catch (error) {
        throw new Error(`${file} could not be created in ${folder}: ${error instanceof Error ? error.message : String(error)}`);
      }
      await deps.openFile(id, file);
    },
    setTarget: (id, target) => deps.edit(id, { target }),
  };
}
