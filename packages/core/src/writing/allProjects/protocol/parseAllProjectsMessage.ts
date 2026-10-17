// Validates a message from the All projects page before the host acts on it.
import type { AllProjectsToHost } from "./messages.js";

const KINDS: readonly unknown[] = ["blank", "template", "folder"];

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

// The host joins the path to the project folder, so a rooted path or a ".." segment would reach files outside it.
const isProjectPath = (value: unknown): value is string =>
  isText(value) && !/^([/\\]|[a-zA-Z]:)/.test(value) && !value.split(/[/\\]/).includes("..");

/** The typed message, or undefined when any field is missing or of the wrong type. */
export function parseAllProjectsMessage(raw: unknown): AllProjectsToHost | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { return undefined; }
  const { type, id, kind, title, folder, archived, trashed, command, path } = raw as Record<string, unknown>;
  if (type === "ready" || type === "emptyTrash") { return { type }; }
  if (type === "create") { return KINDS.includes(kind) ? { type, kind: kind as "blank" | "template" | "folder" } : undefined; }
  if (typeof id !== "string") { return undefined; }
  switch (type) {
    case "open": case "deleteForever": case "files": return { type, id };
    case "openFile": return isProjectPath(path) ? { type, id, path } : undefined;
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
