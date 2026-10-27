// Tells what this device knows of a project's share, from its entry and its share connection.
import type { ShareConnection, ShareConnectionState } from "../../../collab/session/index.js";
import type { ProjectEntry } from "../../../writing/project/index.js";
import type { ProjectShareState } from "../shareHost.js";

const TRASHED = "This project is in the trash.";
const UNREADABLE = "LabShelf cannot read this project's settings.";

/** Undefined when the project may be shared or left here. */
export function deriveIneligibleReason(entry: ProjectEntry): string | undefined {
  if (entry.kind !== "ready") { return UNREADABLE; }
  return entry.settings.trashed ? TRASHED : undefined;
}

function mirrorProblem(mirror: ShareConnectionState["mirror"]): string | undefined {
  if (mirror.kind === "stopped") { return `Edits are not written to disk: ${mirror.reason}`; }
  if (mirror.kind === "running") { return undefined; }
  const who = mirror.holder === "tab" ? "Another tab of this browser" : mirror.holder.app === "vscode" ? "VS Code" : "The browser";
  return `${who} mirrors this project's files; edits here are not written to disk.`;
}

/** The name a project goes by in messages. */
export function deriveProjectName(entry: ProjectEntry): string {
  return entry.kind === "ready" ? entry.settings.title ?? entry.settings.id : entry.folder.split(/[\\/]/).filter(Boolean).pop() ?? entry.folder;
}

/** What keeps a connected share's edits from this device's storage or disk; undefined when nothing does. */
export function deriveConnectionProblem(connection: ShareConnection): string | undefined {
  const state = connection.state();
  return state.persistenceFailure ?? mirrorProblem(state.mirror);
}

export function deriveProjectShare(entry: ProjectEntry, connection: ShareConnection | undefined): ProjectShareState {
  const reason = deriveIneligibleReason(entry);
  if (reason !== undefined) { return { kind: "ineligible", reason }; }
  if (entry.kind !== "ready" || entry.settings.shared === undefined) { return { kind: "notShared" }; }
  if (!connection) { return { kind: "shared", connected: false }; }
  const problem = deriveConnectionProblem(connection);
  return { kind: "shared", connected: connection.state().status === "open", ...(problem === undefined ? {} : { problem }) };
}
