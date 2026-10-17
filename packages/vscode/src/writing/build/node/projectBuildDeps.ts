// Assembles the core build dependencies from the extension: a session-following logger, the storage folder and the project data.
import type { ILogger } from "@labshelf/core";
import type { ProjectBuildDeps } from "@labshelf/core/node";

import { vscodeToolchainPrompt } from "../toolchain/index.js";
import type { WritingHost, WritingProjects } from "../../session/index.js";

export interface ProjectBuildDepsSource {
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "data" | "reload">;
  /** The extension's global storage folder; Tectonic is installed under it. */
  storageDir: string;
  typst: ProjectBuildDeps["typst"];
}

/** Forwards to the open library's logger, which changes while a long-lived build queue keeps its deps. */
function sessionLogger(host: Pick<WritingHost, "current">): ILogger {
  return {
    log: async (...args) => { await host.current()?.logger.log(...args); },
    error: async (...args) => { await host.current()?.logger.error(...args); },
  };
}

/** The project data port with the project list reloaded once the engine is saved. */
export function reloadingProjects(projects: Pick<WritingProjects, "data" | "reload">): ProjectBuildDeps["projects"] {
  return {
    projectBuildDir: (id) => projects.data.projectBuildDir(id),
    updateProjectSettings: async (folder, patch) => {
      await projects.data.updateProjectSettings(folder, patch);
      await projects.reload();
    },
  };
}

export function projectBuildDeps(source: ProjectBuildDepsSource): ProjectBuildDeps {
  return {
    logger: sessionLogger(source.host),
    toolchain: vscodeToolchainPrompt,
    storageDir: source.storageDir,
    projects: reloadingProjects(source.projects),
    typst: source.typst,
  };
}
