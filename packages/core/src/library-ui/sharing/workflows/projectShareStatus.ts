// Tells what this device knows of a project's share, from its entry and its share connection.
import type { ShareConnection, ShareConnectionState } from "../../../collab/session/index.js";
import type { ProjectEntry } from "../../../writing/project/index.js";
import type { ProjectShareStatus } from "../sharingHost.js";

export const TRASHED = "This project is in the trash.";
export const UNREADABLE = "LabShelf cannot read this project's settings.";

/** Undefined when the project may be shared or left here. */
export function ineligibleReason(entry: ProjectEntry): string | undefined {
  if (entry.kind !== "ready") { return UNREADABLE; }
  return entry.settings.trashed ? TRASHED : undefined;
}

function mirrorProblem(mirror: ShareConnectionState["mirror"]): string | undefined {
  if (mirror.kind === "stopped") { return `Edits are not written to disk: ${mirror.reason}`; }
  if (mirror.kind === "running") { return undefined; }
  const who = mirror.holder === "tab" ? "Another tab of this browser" : mirror.holder.app === "vscode" ? "VS Code" : "The browser";
  return `${who} mirrors this project's files; edits here are not written to disk.`;
}

export function projectShareStatus(entry: ProjectEntry, connection: ShareConnection | undefined): ProjectShareStatus {
  const reason = ineligibleReason(entry);
  if (reason !== undefined) { return { kind: "ineligible", reason }; }
  if (entry.kind !== "ready" || entry.settings.shared === undefined) { return { kind: "notShared" }; }
  if (!connection) { return { kind: "shared", connected: false }; }
  const state = connection.state();
  const problem = state.persistenceFailure ?? mirrorProblem(state.mirror);
  return { kind: "shared", connected: state.status === "open", ...(problem === undefined ? {} : { problem }) };
}
