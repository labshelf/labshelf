// Opens helper projects under the library root the shared configuration names when each project opens.
// CONTRACT: documents/contracts/helper.md#messages
import type { ILogger } from "../../../../ports/index.js";
import { readSharedLibraryRoot } from "../../../../library/node/index.js";
import { createHelperProjects, HelperProjectError, type HelperProjects } from "../projects/index.js";

const MODULE = "writing/helper/libraryProjects";

export interface LibraryProjectsOptions {
  /** The shared configuration file; the platform's default when absent. */
  sharedConfigFile?: string;
  logger: ILogger;
}

export interface LibraryProjects extends HelperProjects {
  closeAll(): Promise<void>;
}

export function createLibraryProjects(options: LibraryProjectsOptions): LibraryProjects {
  const { logger } = options;
  let current: { root: string; projects: HelperProjects } | undefined;
  const open = new Set<string>();

  const closeAll = async () => {
    for (const id of [...open]) { await current?.projects.close(id); }
    open.clear();
  };

  // INVARIANT: every open project belongs to `current`, so a changed library root first closes them all.
  async function projectsFor(): Promise<HelperProjects> {
    const root = await readSharedLibraryRoot(options.sharedConfigFile, logger);
    if (!root) { throw new HelperProjectError("no-library", "No library folder is set up on this computer"); }
    if (current?.root !== root) {
      if (current) { await logger.log("INFO", MODULE, "Library root changed; closing open projects", { from: current.root, to: root, open: open.size }); }
      await closeAll();
      current = { root, projects: createHelperProjects({ libraryRoot: root, logger }) };
    }
    return current.projects;
  }

  const owner = (projectId: string): HelperProjects => {
    if (!current || !open.has(projectId)) { throw new HelperProjectError("project-id", `Project "${projectId}" is not open`); }
    return current.projects;
  };

  return {
    async open(projectId, root) {
      const result = await (await projectsFor()).open(projectId, root);
      open.add(projectId);
      return result;
    },
    async close(projectId) {
      await owner(projectId).close(projectId);
      open.delete(projectId);
    },
    edit: (projectId, path, version, body) => owner(projectId).edit(projectId, path, version, body),
    save: (projectId, path) => owner(projectId).save(projectId, path),
    textOf: (projectId, path) => owner(projectId).textOf(projectId, path),
    syncWorkingCopy: (projectId, srcDir) => owner(projectId).syncWorkingCopy(projectId, srcDir),
    closeAll,
  };
}
