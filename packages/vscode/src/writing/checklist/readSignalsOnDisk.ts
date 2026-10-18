// Reads a project's checklist signals from the local disk.
import { nodeProjectReadContext } from "@labshelf/core/node";
import { readChecklistSignals, type ChecklistSignals, type ILogger } from "@labshelf/core";
import type { ReadyProject } from "../mainDocument.js";

export function readSignalsOnDisk(project: ReadyProject, logger: ILogger): Promise<ChecklistSignals> {
  return readChecklistSignals(nodeProjectReadContext(logger), project);
}
