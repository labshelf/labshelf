// Declares the messages between the Library sidebar webview and the extension host, and checks the ones the webview sends.
import { PAPERS_DIR, type FolderTreeNode } from "../library/index.js";
import type { SidebarRow } from "../spaces/index.js";
import { isProjectTreeView, type ProjectTreeView, type SidebarOpenProject, type SidebarProjectItem, type TreePaper } from "./folderModel.js";

export type HostToSidebar =
  | { type: "spaces"; rows: SidebarRow[] }
  | { type: "library"; folders: FolderTreeNode[]; papers: Array<{ record: TreePaper; folder: string }> }
  /** The folder the list panel shows; `papers` for the library root. */
  | { type: "current"; folder: string }
  | { type: "selected"; id: string | null }
  | { type: "projects"; projects: SidebarProjectItem[] }
  /** The project open in the window with its trees, or null when none is open. */
  | { type: "openProject"; project: SidebarOpenProject | null };

/** What a row or title action of the open project's trees asks for; `view` and `key` name the row. */
export interface ProjectTreeMessage {
  type: "projectTree";
  op: "close" | "action" | "click" | "toggle" | "check" | "menu" | "add";
  view?: ProjectTreeView;
  key?: string;
  action?: string;
  open?: boolean;
  checked?: boolean;
  /** The typed text of an inline add input. */
  text?: string;
}

export type ProjectAction = "browseTemplates" | "allProjects" | "newBlank" | "addExisting" | "refresh";

/** What a project folder row or the My projects heading asks for; `path` is "" for the top level. */
export type ProjectFolderAction = "new" | "rename" | "delete";

/** What the project menu asks for beyond the project commands. */
export type ProjectUpdate = "move" | "archive";

export type SidebarToHost =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "openFolder"; path: string }
  | { type: "revealPaper"; id: string }
  | { type: "searchTag"; tag: string }
  | { type: "createFolder"; path: string }
  /** Opens the import dialog for a folder. */
  | { type: "addFiles"; path: string }
  | { type: "renameFolder"; path: string }
  | { type: "removeFolder"; path: string }
  /** Files dropped from the OS onto a folder: `uris` is the drop's text/uri-list. */
  | { type: "import"; path: string; uris: string }
  | { type: "moveFolder"; path: string; target: string }
  | { type: "openProject"; id: string }
  /** A command from a project menu; `command` is one of PROJECT_COMMANDS or OPEN_PROJECT_COMMANDS. */
  | { type: "projectCommand"; id: string; command: string }
  | { type: "projectAction"; action: ProjectAction }
  | { type: "projectFolder"; action: ProjectFolderAction; path: string }
  | { type: "projectEdit"; id: string; edit: ProjectUpdate }
  | ProjectTreeMessage
  | SidebarSpaceMessage;

const PROJECT_ACTIONS: readonly string[] = ["browseTemplates", "allProjects", "newBlank", "addExisting", "refresh"];
const PROJECT_FOLDER_ACTIONS: readonly string[] = ["new", "rename", "delete"];
const PROJECT_EDITS: readonly string[] = ["move", "archive"];
const TREE_OPS: readonly string[] = ["close", "action", "click", "toggle", "check", "menu", "add"];
const MAX_ADD_TEXT = 500;

// Each op carries exactly the fields it needs, with the right types.
function isProjectTreeMessage(m: Record<string, unknown>): boolean {
  const op = m["op"];
  if (!TREE_OPS.includes(op as string)) { return false; }
  if (op === "close") { return true; }
  if (op === "action") { return typeof m["action"] === "string"; }
  if (!isProjectTreeView(m["view"]) || typeof m["key"] !== "string") { return false; }
  if (op === "toggle") { return typeof m["open"] === "boolean"; }
  if (op === "check") { return typeof m["checked"] === "boolean"; }
  if (op === "menu") { return typeof m["action"] === "string"; }
  if (op === "add") { return typeof m["text"] === "string" && m["text"].trim() !== "" && m["text"].length <= MAX_ADD_TEXT; }
  return true;
}

// A project folder path is "" or "/"-joined names, none of them blank.
const isProjectFolderPath = (v: unknown): v is string => typeof v === "string" && (v === "" || !v.split("/").some((s) => s.trim() === ""));
const PATH_KEYS = ["openFolder", "createFolder", "addFiles", "renameFolder", "removeFolder", "import", "moveFolder"];

// A tree path starts at papers/ and never climbs out of it.
const isTreePath = (v: unknown): v is string =>
  typeof v === "string" && (v === PAPERS_DIR || v.startsWith(`${PAPERS_DIR}/`)) && !v.split("/").some((s) => s === ".." || s === "." || s === "");

/**
 * @param isProjectCommand whether a command is one the project menus offer; the host owns that list
 * @returns the message when it is well formed, or null for anything a webview should never send
 */
export function parseSidebarMessage(raw: unknown, isProjectCommand: (command: string) => boolean): SidebarToHost | null {
  if (!raw || typeof raw !== "object") { return null; }
  const m = raw as Record<string, unknown>;
  if (PATH_KEYS.includes(m["type"] as string) && !isTreePath(m["path"])) { return null; }
  switch (m["type"]) {
    case "spaceAction": return isSidebarSpaceMessage(m) ? (m as SidebarToHost) : null;
    case "ready": case "refresh": case "openFolder": case "createFolder": case "addFiles": case "renameFolder": case "removeFolder":
      return m as SidebarToHost;
    case "searchTag": return typeof m["tag"] === "string" ? (m as SidebarToHost) : null;
    case "revealPaper": return typeof m["id"] === "string" ? (m as SidebarToHost) : null;
    case "import": return typeof m["uris"] === "string" ? (m as SidebarToHost) : null;
    case "openProject": return typeof m["id"] === "string" ? (m as SidebarToHost) : null;
    case "projectCommand":
      return typeof m["id"] === "string" && isProjectCommand(m["command"] as string) ? (m as SidebarToHost) : null;
    case "projectAction": return PROJECT_ACTIONS.includes(m["action"] as string) ? (m as SidebarToHost) : null;
    case "projectFolder": return PROJECT_FOLDER_ACTIONS.includes(m["action"] as string) && isProjectFolderPath(m["path"]) ? (m as SidebarToHost) : null;
    case "projectEdit": return typeof m["id"] === "string" && PROJECT_EDITS.includes(m["edit"] as string) ? (m as SidebarToHost) : null;
    case "moveFolder": return isTreePath(m["target"]) ? (m as SidebarToHost) : null;
    case "projectTree": return isProjectTreeMessage(m) ? (m as SidebarToHost) : null;
    default: return null;
  }
}

export type SidebarSpaceMessage = { type: "spaceAction" } & (
  | { action: "openCatalog" | "newSpace" }
  | { action: "openSpace"; id: string; folder?: string }
  | { action: "openPaper" | "renameSpace" | "deleteSpace"; id: string }
  | { action: "newFolder"; spaceId: string; parent?: string }
  | { action: "renameFolder" | "deleteFolder"; spaceId: string; folder: string }
  | { action: "dropPapers"; spaceId: string; folder?: string; paperIds: string[] }
  | { action: "removeReference"; spaceId: string; paperId: string }
);

const id = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const spaceId = (value: unknown): boolean => id(value) && !value.startsWith(".") && !/[/\\]/.test(value);
const optionalId = (value: unknown): boolean => value === undefined || id(value);

function isSidebarSpaceMessage(m: Record<string, unknown>): boolean {
  switch (m["action"]) {
    case "openCatalog": case "newSpace": return true;
    case "openSpace": return spaceId(m["id"]) && optionalId(m["folder"]);
    case "openPaper": return id(m["id"]);
    case "renameSpace": case "deleteSpace": return spaceId(m["id"]);
    case "newFolder": return spaceId(m["spaceId"]) && optionalId(m["parent"]);
    case "renameFolder": case "deleteFolder": return spaceId(m["spaceId"]) && id(m["folder"]);
    case "removeReference": return spaceId(m["spaceId"]) && id(m["paperId"]);
    case "dropPapers": return spaceId(m["spaceId"]) && optionalId(m["folder"]) && Array.isArray(m["paperIds"])
      && m["paperIds"].length > 0 && m["paperIds"].every(id);
    default: return false;
  }
}
