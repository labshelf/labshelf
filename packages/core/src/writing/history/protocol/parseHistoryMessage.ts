// Validates a message from the project history page before the host acts on it.
import type { HistoryToHost } from "./messages.js";

/** The typed message, or undefined when any field is missing or of the wrong type. */
export function parseHistoryMessage(raw: unknown): HistoryToHost | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { return undefined; }
  const { type, id, path } = raw as Record<string, unknown>;
  switch (type) {
    case "ready": case "markVersion": case "compareVersions": return { type };
    case "diff": return typeof id === "string" && typeof path === "string" ? { type, id, path } : undefined;
    case "restore": return typeof id === "string" ? { type, id } : undefined;
    default: return undefined;
  }
}
