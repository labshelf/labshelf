// Declares what the toolchain setup and the engine save need from the extension, and writes the chosen engine to labshelf.yaml.
import type { LatexEngine } from "@labshelf/core";
import type { ToolchainDeps as CoreToolchainDeps } from "@labshelf/core/node";
import { executeSafely } from "../../../command/index.js";
import type { ReadyProject } from "../../buildRootDocument.js";
import type { WritingHost, WritingProjects } from "../../session/index.js";

export interface ToolchainDeps {
  /** The per-user TeX every LabShelf app shares. */
  tex: CoreToolchainDeps["tex"];
  host: Pick<WritingHost, "current">;
}

export interface SaveEngineDeps {
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "data" | "reload">;
}

/** Stores the engine in the project's labshelf.yaml and reloads the project list; false when it could not be saved. */
export async function saveEngine(deps: SaveEngineDeps, project: ReadyProject, engine: LatexEngine): Promise<boolean> {
  const session = deps.host.current();
  if (!session) { return false; }
  let saved = false;
  await executeSafely(session.logger, "labshelf.writing.setEngine", async () => {
    await deps.projects.data.updateProjectSettings(project.folder, { engine });
    await deps.projects.reload();
    saved = true;
  });
  return saved;
}
