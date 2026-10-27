// Declares the messages between the All projects page and its host, the channel that carries them, and validates a page message.
import { isNonBlankString } from "../../guards/index.js";
import type { MessageEnd } from "../../libraryUi/protocol/index.js";
import { isProjectPath } from "../../path/index.js";
import type { CreateProjectKind, ProjectMenuCommand, ProjectPaneContent, ProjectRow } from "./projectModel.js";

export type AllProjectsToHost =
  | { type: "ready" }
  | { type: "open"; id: string }
  | { type: "create"; kind: CreateProjectKind }
  | { type: "rename"; id: string; title: string }
  | { type: "duplicate"; id: string; title: string }
  /** `folder` is "/"-joined; absent moves the project to the top level. */
  | { type: "move"; id: string; folder?: string }
  | { type: "archive"; id: string; archived: boolean }
  | { type: "trash"; id: string; trashed: boolean }
  | { type: "deleteForever"; id: string }
  | { type: "emptyTrash" }
  /** Runs one of the host's own `commands` on the project. */
  | { type: "command"; id: string; command: string }
  /** Asks for the project's file listing each time its row expands. */
  | { type: "files"; id: string }
  /** `path` is one of the listed files: relative and "/"-separated. */
  | { type: "openFile"; id: string; path: string }
  /** The selected project changed; null when none is selected. */
  | { type: "project.selected"; id: string | null }
  /** Asks for the detail pane's data each time a row is selected. */
  | { type: "detail"; id: string }
  | { type: "build"; id: string }
  | { type: "preview"; id: string }
  | { type: "openLog"; id: string }
  /** `path` is project-relative and "/"-separated. */
  | { type: "createFile"; id: string; path: string }
  /** `deadline` is YYYY-MM-DD; both fields absent removes the target. */
  | { type: "setTarget"; id: string; venue?: string; deadline?: string };

export type HostToAllProjects =
  | { type: "projects"; rows: ProjectRow[]; commands: ProjectMenuCommand[]; newKinds: CreateProjectKind[]; openLabel: string }
  | { type: "error"; message: string }
  | { type: "files"; id: string; files: string[] }
  | { type: "files"; id: string; error: string }
  | { type: "detail"; id: string; detail: ProjectPaneContent }
  | { type: "detail"; id: string; error: string };

/** The page side of the channel. */
export type AllProjectsTransport = MessageEnd<AllProjectsToHost, HostToAllProjects>;

/** The host side of the channel. */
export type AllProjectsEndpoint = MessageEnd<HostToAllProjects, AllProjectsToHost>;

const KINDS: readonly unknown[] = ["blank", "template", "folder"];

const MAX_VENUE = 200;

// The patch writer does not check the date, so a value like 2027-02-30 would reach labshelf.yaml.
function isDate(value: unknown): value is string {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) { return false; }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseTarget(id: string, venue: unknown, deadline: unknown): AllProjectsToHost | undefined {
  if (venue !== undefined && (typeof venue !== "string" || venue.length > MAX_VENUE)) { return undefined; }
  if (deadline !== undefined && !isDate(deadline)) { return undefined; }
  return {
    type: "setTarget", id,
    ...(venue !== undefined ? { venue } : {}),
    ...(deadline !== undefined ? { deadline } : {}),
  };
}

/** The typed message, or undefined when any field is missing or of the wrong type. */
export function parseAllProjectsMessage(raw: unknown): AllProjectsToHost | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { return undefined; }
  const { type, id, kind, title, folder, archived, trashed, command, path, venue, deadline } = raw as Record<string, unknown>;
  if (type === "ready" || type === "emptyTrash") { return { type }; }
  if (type === "create") { return KINDS.includes(kind) ? { type, kind: kind as "blank" | "template" | "folder" } : undefined; }
  if (type === "project.selected") { return id === null || isNonBlankString(id) ? { type, id } : undefined; }
  if (typeof id !== "string") { return undefined; }
  switch (type) {
    case "open": case "deleteForever": case "files": case "detail": case "build": case "preview": case "openLog": return { type, id };
    // The host joins the path to the project folder, so it must stay inside it.
    case "openFile": case "createFile": return isNonBlankString(path) && isProjectPath(path) ? { type, id, path } : undefined;
    case "setTarget": return parseTarget(id, venue, deadline);
    case "rename": case "duplicate": return isNonBlankString(title) ? { type, id, title: title.trim() } : undefined;
    case "move":
      if (folder === undefined) { return { type, id }; }
      return typeof folder === "string" ? { type, id, folder } : undefined;
    case "archive": return typeof archived === "boolean" ? { type, id, archived } : undefined;
    case "trash": return typeof trashed === "boolean" ? { type, id, trashed } : undefined;
    case "command": return typeof command === "string" ? { type, id, command } : undefined;
    default: return undefined;
  }
}
