// Declares what the toolchain setup needs from the extension and writes the chosen engine to labshelf.yaml.
import { updateProjectSettings } from "@labshelf/core/node";
import type { LatexEngine } from "@labshelf/core";
import { executeSafely } from "../../../commands/index.js";
import type { ReadyProject } from "../../mainDocument.js";
import type { WritingHost, WritingProjects } from "../../projectStore.js";

export interface ToolchainDeps {
  /** The extension's global storage folder; Tectonic is installed under it. */
  storageDir: string;
  host: WritingHost;
  projects: Pick<WritingProjects, "reload">;
}

/** Stores the engine in the project's labshelf.yaml and reloads the project list; false when it could not be saved. */
export async function saveEngine(deps: Pick<ToolchainDeps, "host" | "projects">, project: ReadyProject, engine: LatexEngine): Promise<boolean> {
  const session = deps.host.current();
  if (!session) { return false; }
  let saved = false;
  await executeSafely(session.logger, "labshelf.writing.setEngine", async () => {
    await updateProjectSettings(project.folder, { engine }, session.logger);
    await deps.projects.reload();
    saved = true;
  });
  return saved;
}
