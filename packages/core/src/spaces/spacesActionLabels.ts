// Names each Spaces page action as its failure messages show it.
import type { SpacesToHost } from "./protocol/index.js";

export const LOAD_CATALOG = "Load Spaces";
export const LOAD_SPACE = "Load Space";

export const ACTION_LABELS: Record<Exclude<SpacesToHost["type"], "ready">, string> = {
  createSpace: "Create Space",
  renameSpace: "Rename Space",
  setPurpose: "Set purpose",
  deleteSpace: "Delete Space",
  addPapers: "Add papers",
  removePaper: "Remove paper",
  setFocus: "Set focus",
  moveReference: "Move paper",
  createFolder: "Create folder",
  renameFolder: "Rename folder",
  deleteFolder: "Delete folder",
  linkProject: "Link project",
  unlinkProject: "Unlink project",
  addDate: "Add date",
  updateDate: "Update date",
  removeDate: "Remove date",
  setDone: "Mark task done",
  addTerm: "Add term",
  updateTerm: "Update term",
  removeTerm: "Remove term",
  openPaper: "Open paper",
  selectPaper: "Show paper details",
  openProject: "Open project",
  openSpace: "Open Space",
  openCatalog: "Open Spaces",
  exportIcs: "Export calendar",
  listPapers: "List papers",
  listProjects: "List projects",
};
