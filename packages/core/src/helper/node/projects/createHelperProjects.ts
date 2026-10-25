// Keeps the helper's open projects: confined roots, versioned unsaved text and the file list.
import type { ILogger } from "../../../ports/index.js";
import { MAX_OPEN_PROJECTS } from "../../helperMessages.js";
import type { ChangeBody } from "./applyUpdate.js";
import { applyChange } from "./applyUpdate.js";
import { HelperProjectError } from "./helperProjectError.js";
import { listProjectFiles } from "./listProjectFiles.js";
import { assertProjectPath, resolveConfinedPath, readProjectText } from "./projectPaths.js";
import type { OpenProject } from "./projectState.js";
import { syncWorkingCopy } from "./syncWorkingCopy.js";

const MODULE = "helper/projects";

export interface HelperProjectsOptions { libraryRoot: string; logger: ILogger }

export interface HelperProjects {
  open(projectId: string, root: string): Promise<{ files: string[] }>;
  close(projectId: string): Promise<void>;
  edit(projectId: string, path: string, version: number, body: ChangeBody): Promise<void>;
  save(projectId: string, path: string): Promise<void>;
  textOf(projectId: string, path: string): Promise<string>;
  syncWorkingCopy(projectId: string, srcDir: string): Promise<void>;
}

export function createHelperProjects(options: HelperProjectsOptions): HelperProjects {
  const { libraryRoot, logger } = options;
  const projects = new Map<string, OpenProject>();

  const projectOf = (id: string): OpenProject => {
    const project = projects.get(id);
    if (!project) { throw new HelperProjectError("project-id", `Project "${id}" is not open`); }
    return project;
  };

  return {
    async open(projectId, root) {
      if (!projects.has(projectId) && projects.size >= MAX_OPEN_PROJECTS) {
        throw new HelperProjectError("limit", `At most ${MAX_OPEN_PROJECTS} projects can be open`);
      }
      const rootDir = await resolveConfinedPath(libraryRoot, root);
      const files = await listProjectFiles(rootDir);
      projects.set(projectId, { root: rootDir, unsaved: new Map(), synced: new Map() });
      await logger.log("INFO", MODULE, "Project opened", { projectId, files: files.length });
      return { files };
    },

    async close(projectId) {
      projectOf(projectId);
      projects.delete(projectId);
      await logger.log("INFO", MODULE, "Project closed", { projectId });
    },

    async edit(projectId, relative, version, body) {
      await applyChange(projectOf(projectId), relative, version, body, (message, context) => logger.log("WARN", MODULE, message, { projectId, ...context }));
    },

    async save(projectId, relative) {
      const project = projectOf(projectId);
      project.unsaved.delete(assertProjectPath(relative));
    },

    async textOf(projectId, relative) {
      const project = projectOf(projectId);
      return project.unsaved.get(assertProjectPath(relative))?.text ?? readProjectText(project.root, relative);
    },

    async syncWorkingCopy(projectId, srcDir) {
      await syncWorkingCopy(projectOf(projectId), srcDir);
    },
  };
}
