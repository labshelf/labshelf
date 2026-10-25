// Builds the reader of a project's checklist signals over the project reads of the open library.
import { readChecklistSignals, type ChecklistSignals, type ILogger } from "@labshelf/core";
import type { ReadyProject } from "../buildRootDocument.js";
import type { WritingProjects } from "../session/index.js";

export function signalsReader(projects: Pick<WritingProjects, "reads">): (project: ReadyProject, logger: ILogger) => Promise<ChecklistSignals> {
  return (project, logger) => readChecklistSignals(projects.reads(logger), project);
}
