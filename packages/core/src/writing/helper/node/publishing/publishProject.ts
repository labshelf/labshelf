// Resolves publication projects inside the configured library using their on-disk settings.
import * as path from "node:path";
import { readSharedLibraryRoot } from "../../../../library/node/index.js";
import type { ILogger } from "../../../../ports/index.js";
import { resolveInLibrary } from "../../../../bridge/node/index.js";
import { readProject } from "../../../project/folder/index.js";
import { nodeProjectReadContext } from "../../../project/node/index.js";
import { engineLabel } from "../../../latex/index.js";
import type { PublishableProject } from "../../../templates/publishing/index.js";

export async function publicationProject(projectId: string, logger: ILogger, sharedConfigFile?: string): Promise<{ libraryRoot: string; project: PublishableProject }> {
  const libraryRoot = await readSharedLibraryRoot(sharedConfigFile, logger);
  if (!libraryRoot) throw new Error("No library folder is set up on this computer");
  const folder = await resolveInLibrary(libraryRoot, `projects/${projectId}`);
  const entry = await readProject(nodeProjectReadContext(logger), folder, "library");
  if (entry.kind !== "ready" || !entry.main || entry.settings.id !== projectId) throw new Error(`Project "${projectId}" is not ready to publish`);
  await resolveInLibrary(folder, entry.main);
  const { format } = entry.settings;
  const engine = format === "typst" ? "typst" : entry.settings.engine ?? "pdflatex";
  return { libraryRoot, project: { id: projectId, title: entry.settings.title ?? projectId, folder: path.resolve(folder), format, engine, main: entry.main,
    engineLabel: engine === "typst" ? "Typst" : engineLabel(engine) } };
}
