// Assembles the core build dependencies from the extension: a session-following logger, the shared TeX and the project data.
import type { ProjectBuildDeps } from "@labshelf/core/node";

import type { WritingHost, WritingProjects } from "../../session/index.js";
import { createVscodeToolchainAsk } from "../toolchain/index.js";
import { createSessionLogger } from "./createSessionLogger.js";

export interface ProjectBuildDepsSource {
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "data" | "fs">;
  tex: ProjectBuildDeps["tex"];
  typst: ProjectBuildDeps["typst"];
}

export function createProjectBuildDeps(source: ProjectBuildDepsSource): ProjectBuildDeps {
  return {
    logger: createSessionLogger(source.host),
    projectWriter: source.projects.fs,
    prompt: createVscodeToolchainAsk(),
    tex: source.tex,
    projects: { projectBuildDir: (id) => source.projects.data.projectBuildDir(id) },
    typst: source.typst,
  };
}
