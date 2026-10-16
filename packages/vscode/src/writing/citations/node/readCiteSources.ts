// Reads the source files of a writing project from disk for the cite-section index.
import { readChecklistSignals } from "@labshelf/core/node";
import type { ChecklistSource, ILogger } from "@labshelf/core";
import type { ReadyProject } from "../../mainDocument.js";

export async function readCiteSources(project: ReadyProject, logger: ILogger): Promise<ChecklistSource[]> {
  return (await readChecklistSignals(project, logger)).sources;
}
