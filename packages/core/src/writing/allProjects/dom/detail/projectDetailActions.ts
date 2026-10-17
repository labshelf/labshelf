// Runs the actions of the project detail pane: posting host actions, the more menu and the target editor.
import { inputBox, showMenu } from "../../../../ui/dom/index.js";
import type { ProjectRow } from "../../projectRow.js";
import type { Post } from "../projectActions.js";
import { projectMenuEntries, type ProjectMenuContext } from "../projectMenu.js";

export interface ProjectDetailActionDeps {
  post: Post;
  /** Read at click time so the menu sees the latest rows and host commands. */
  menu: () => ProjectMenuContext;
}

function validateDeadline(value: string): string | null {
  if (value === "") return null;
  // The round trip rejects impossible dates such as 2027-02-31, which Date.parse would roll over.
  const at = Date.parse(`${value}T00:00:00Z`);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(at) && new Date(at).toISOString().slice(0, 10) === value;
  return valid ? null : "Write the deadline as YYYY-MM-DD";
}

async function editTarget(row: ProjectRow, post: Post): Promise<void> {
  const venue = await inputBox({ title: "Target venue", prompt: "Where is this project headed? Leave empty to clear it.", value: row.target?.venue ?? "" });
  if (venue === undefined) return;
  const deadline = await inputBox({ title: "Deadline", prompt: "YYYY-MM-DD. Leave empty for no deadline.", value: row.target?.deadline ?? "", validate: validateDeadline });
  if (deadline === undefined) return;
  post({ type: "setTarget", id: row.id, ...(venue ? { venue } : {}), ...(deadline ? { deadline } : {}) });
}

export function runProjectDetailAction(action: string, anchor: HTMLElement, row: ProjectRow, deps: ProjectDetailActionDeps): void {
  if (action === "open" || action === "preview" || action === "build" || action === "openLog") deps.post({ type: action, id: row.id });
  else if (action === "more") showMenu(anchor, projectMenuEntries(row, deps.menu()));
  else if (action === "editTarget") void editTarget(row, deps.post);
}
