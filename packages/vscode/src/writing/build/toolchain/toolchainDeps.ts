// Declares what the toolchain setup needs from the extension and writes the chosen engine to labshelf.yaml.
import type { LatexEngine } from "@labshelf/core";
import { executeSafely } from "../../../commands/index.js";
import type { ReadyProject } from "../../mainDocument.js";
import type { WritingHost, WritingProjects } from "../../session/index.js";

export interface ToolchainDeps {
  /** The extension's global storage folder; Tectonic is installed under it. */
  storageDir: string;
  host: WritingHost;
  projects: Pick<WritingProjects, "data" | "reload">;
}

/** Stores the engine in the project's labshelf.yaml and reloads the project list; false when it could not be saved. */
export async function saveEngine(deps: Pick<ToolchainDeps, "host" | "projects">, project: ReadyProject, engine: LatexEngine): Promise<boolean> {
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
