// Writes a limits change from the preview into the project's labshelf.yaml.
import type { CheckLimitsChange } from "@labshelf/core";

import type { ReadyProject } from "../../mainDocument.js";
import type { WritingProjects } from "../../session/index.js";

/** A number sets a limit, null removes it, and an absent field keeps what the file holds. */
export async function setCheckLimits(
  projects: Pick<WritingProjects, "data" | "reload">,
  project: ReadyProject,
  change: CheckLimitsChange,
): Promise<void> {
  const check: { pages?: number | undefined; words?: number | undefined; countUpTo?: "references" | "end" } = {};
  if (change.pages !== undefined) { check.pages = change.pages ?? undefined; }
  if (change.words !== undefined) { check.words = change.words ?? undefined; }
  if (change.countUpTo !== undefined) { check.countUpTo = change.countUpTo; }
  await projects.data.updateProjectSettings(project.folder, { check });
  await projects.reload();
}
