// Applies one page edit to a project's unsaved text: a whole-file text or ranges against the previous version.
import { MAX_PROJECT_FILES, type TextChange } from "../../helperMessages.js";
import { applyTextChanges } from "./applyTextChanges.js";
import { HelperProjectError } from "./helperProjectError.js";
import { listProjectFiles } from "./listProjectFiles.js";
import { checkedPath, confined } from "./projectPaths.js";
import type { OpenProject } from "./projectState.js";

export type EditBody = { text: string } | { changes: readonly TextChange[] };

/** @throws limit when the project, counting disk files and unsaved texts, would pass the file cap */
async function checkRoomForNewFile(project: OpenProject, relative: string): Promise<void> {
  const paths = new Set(await listProjectFiles(project.root));
  for (const path of project.unsaved.keys()) { paths.add(path); }
  paths.add(relative);
  if (paths.size > MAX_PROJECT_FILES) { throw new HelperProjectError("limit", `A project holds at most ${MAX_PROJECT_FILES} files`); }
}

export async function applyEdit(
  project: OpenProject,
  relative: string,
  version: number,
  body: EditBody,
  warn: (message: string, context: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  checkedPath(relative);
  await confined(project.root, relative);
  if ("text" in body) {
    if (!project.unsaved.has(relative)) { await checkRoomForNewFile(project, relative); }
    project.unsaved.set(relative, { text: body.text, version });
    return;
  }
  const current = project.unsaved.get(relative);
  if (!current || current.version !== version - 1) {
    const helperVersion = current?.version ?? 0;
    await warn("Edit does not follow the helper's version", { path: relative, version, helperVersion });
    throw new HelperProjectError("stale", `Changes for "${relative}" do not follow version ${helperVersion}`);
  }
  project.unsaved.set(relative, { text: applyTextChanges(current.text, body.changes), version });
}
