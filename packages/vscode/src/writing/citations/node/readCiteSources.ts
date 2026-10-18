// Reads the source files of a writing project from disk for the cite-section index.
import type { ChecklistSource, ILogger } from "@labshelf/core";
import { readSignalsOnDisk } from "../../checklist/index.js";
import type { ReadyProject } from "../../mainDocument.js";

export async function readCiteSources(project: ReadyProject, logger: ILogger): Promise<ChecklistSource[]> {
  return (await readSignalsOnDisk(project, logger)).sources;
}
