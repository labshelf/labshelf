// Applies one page edit to a project's unsaved text: a whole-file text or ranges against the previous version.
import { MAX_PROJECT_FILES, type TextChange, MAX_EDIT_CHANGES } from "../../helperMessages.js";
import { HelperProjectError } from "./helperProjectError.js";
import { listProjectFiles } from "./listProjectFiles.js";
import { assertProjectPath, resolveConfinedPath } from "./projectPaths.js";
import type { OpenProject } from "./projectState.js";

/** @throws stale when a range is outside the text or ranges overlap; limit past the changes cap */
function applyTextChanges(text: string, changes: readonly TextChange[]): string {
  if (changes.length > MAX_EDIT_CHANGES) {
    throw new HelperProjectError("limit", `An edit holds at most ${MAX_EDIT_CHANGES} changes`);
  }
  const ordered = [...changes].sort((a, b) => a.from - b.from || a.to - b.to);
  let cursor = 0;
  let out = "";
  for (const { from, to, insert } of ordered) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < cursor || to < from || to > text.length) {
      throw new HelperProjectError("stale", "A change does not fit the helper's text");
    }
    out += text.slice(cursor, from) + insert;
    cursor = to;
  }
  return out + text.slice(cursor);
}

export type ChangeBody = { text: string } | { changes: readonly TextChange[] };

/** @throws limit when the project, counting disk files and unsaved texts, would pass the file cap */
async function checkRoomForNewFile(project: OpenProject, relative: string): Promise<void> {
  const paths = new Set(await listProjectFiles(project.root));
  for (const path of project.unsaved.keys()) { paths.add(path); }
  paths.add(relative);
  if (paths.size > MAX_PROJECT_FILES) { throw new HelperProjectError("limit", `A project holds at most ${MAX_PROJECT_FILES} files`); }
}

export async function applyChange(
  project: OpenProject,
  relative: string,
  version: number,
  body: ChangeBody,
  warn: (message: string, context: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  assertProjectPath(relative);
  await resolveConfinedPath(project.root, relative);
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
