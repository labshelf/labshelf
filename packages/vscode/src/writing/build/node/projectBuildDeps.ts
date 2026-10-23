// Assembles the core build dependencies from the extension: a session-following logger, the shared TeX and the project data.
import type { ProjectBuildDeps } from "@labshelf/core/node";

import type { WritingHost, WritingProjects } from "../../session/index.js";
import { vscodeToolchainPrompt } from "../toolchain/index.js";
import { sessionLogger } from "./sessionLogger.js";

export interface ProjectBuildDepsSource {
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "data" | "fs">;
  tex: ProjectBuildDeps["tex"];
  typst: ProjectBuildDeps["typst"];
}

export function projectBuildDeps(source: ProjectBuildDepsSource): ProjectBuildDeps {
  return {
    logger: sessionLogger(source.host),
    projectWriter: source.projects.fs,
    prompt: vscodeToolchainPrompt(),
    tex: source.tex,
    projects: { projectBuildDir: (id) => source.projects.data.projectBuildDir(id) },
    typst: source.typst,
  };
}
