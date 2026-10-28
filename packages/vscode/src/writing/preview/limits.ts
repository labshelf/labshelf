// Writes the check limits a reader change sets into the project's labshelf.yaml.
import { deriveCheckLimitsPatch, type CheckLimitsChange } from "@labshelf/core";
import type { ReadyProject } from "../projects/index.js";
import type { WritingProjects } from "../projects/index.js";

/** A number sets a limit, null removes it, and an absent field keeps what the file holds. */
export async function setCheckLimits(
  projects: Pick<WritingProjects, "data" | "reload">,
  project: ReadyProject,
  change: CheckLimitsChange,
): Promise<void> {
  await projects.data.updateProjectSettings(project.folder, { check: deriveCheckLimitsPatch(change) });
  await projects.reload();
}
