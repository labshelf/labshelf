// Validates a message from the Spaces page before the host acts on it, keeping only the known fields.
import { isNonEmptyString, isRecord } from "../model/json/index.js";
import { SPACE_TABS, type SpaceTab, type SpacesToHost } from "./messages.js";
import { parseSpaceMutation } from "./parseSpaceMutation.js";

const isTab = (value: unknown): value is SpaceTab => (SPACE_TABS as readonly unknown[]).includes(value);

function parseReady(view: unknown, id: unknown): SpacesToHost | undefined {
  if (view === "catalog") { return { type: "ready", view }; }
  return view === "space" && isNonEmptyString(id) ? { type: "ready", view, id } : undefined;
}

/** The typed message, or undefined when the type is unknown or a field is missing or of the wrong type. */
export function parseSpacesMessage(value: unknown): SpacesToHost | undefined {
  if (!isRecord(value)) { return undefined; }
  const { type, view, id, paperId, projectId, tab } = value;
  switch (type) {
    case "ready": return parseReady(view, id);
    case "openPaper": case "selectPaper": return isNonEmptyString(paperId) ? { type, paperId } : undefined;
    case "openProject": return isNonEmptyString(projectId) ? { type, projectId } : undefined;
    case "openSpace":
      if (!isNonEmptyString(id)) { return undefined; }
      if (tab === undefined) { return { type, id }; }
      return isTab(tab) ? { type, id, tab } : undefined;
    case "openCatalog": case "listPapers": case "listProjects": return { type };
    case "exportIcs": return isNonEmptyString(id) ? { type, id } : undefined;
    default: return parseSpaceMutation(value);
  }
}
