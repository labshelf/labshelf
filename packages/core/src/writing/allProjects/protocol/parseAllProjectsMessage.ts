// Validates a message from the All projects page before the host acts on it.
import type { AllProjectsToHost } from "./messages.js";

const KINDS: readonly unknown[] = ["blank", "template", "folder"];

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

// The host joins the path to the project folder, so a rooted path or a ".." segment would reach files outside it.
const isProjectPath = (value: unknown): value is string =>
  isText(value) && !/^([/\\]|[a-zA-Z]:)/.test(value) && !value.includes("\0") && !value.split(/[/\\]/).includes("..");

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
  if (type === "project.selected") { return id === null || isText(id) ? { type, id } : undefined; }
  if (typeof id !== "string") { return undefined; }
  switch (type) {
    case "open": case "deleteForever": case "files": case "detail": case "build": case "preview": case "openLog": return { type, id };
    case "openFile": case "createFile": return isProjectPath(path) ? { type, id, path } : undefined;
    case "setTarget": return parseTarget(id, venue, deadline);
    case "rename": case "duplicate": return isText(title) ? { type, id, title: title.trim() } : undefined;
    case "move":
      if (folder === undefined) { return { type, id }; }
      return typeof folder === "string" ? { type, id, folder } : undefined;
    case "archive": return typeof archived === "boolean" ? { type, id, archived } : undefined;
    case "trash": return typeof trashed === "boolean" ? { type, id, trashed } : undefined;
    case "command": return typeof command === "string" ? { type, id, command } : undefined;
    default: return undefined;
  }
}
