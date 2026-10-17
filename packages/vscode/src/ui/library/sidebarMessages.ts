// Declares the messages between the Library sidebar webview and the extension host, and checks the ones the webview sends.
import { PROJECT_COMMANDS } from "./projectCommands.js";
import { PAPERS_DIR, type ArcProgress, type ArcTone, type FolderTreeNode, type TreePaper } from "@labshelf/core";

/**
 * A writing project as the sidebar lists it, plus what the host needs to offer the right menu.
 * The first fields are core's `SidebarProject` (@labshelf/core/dom), declared here because the node build cannot load the DOM-typed module.
 */
export interface SidebarProjectItem {
  id: string;
  name: string;
  group: string;
  mark: { tone: ArcTone; progress: ArcProgress };
  count?: string;
  tooltip: string;
  kind: "ready" | "broken";
  external: boolean;
}

export type HostToSidebar =
  | { type: "library"; folders: FolderTreeNode[]; papers: Array<{ record: TreePaper; folder: string }> }
  /** The folder the list panel shows; `papers` for the library root. */
  | { type: "current"; folder: string }
  | { type: "selected"; id: string | null }
  | { type: "projects"; projects: SidebarProjectItem[] };

export type ProjectAction = "browseTemplates" | "newBlank" | "addExisting";

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
  /** A command from the project menu; `command` is one of PROJECT_COMMANDS. */
  | { type: "projectCommand"; id: string; command: string }
  | { type: "projectAction"; action: ProjectAction };

const PROJECT_ACTIONS: readonly string[] = ["browseTemplates", "newBlank", "addExisting"];
const PATH_KEYS = ["openFolder", "createFolder", "addFiles", "renameFolder", "removeFolder", "import", "moveFolder"];

// A tree path starts at papers/ and never climbs out of it.
const isTreePath = (v: unknown): v is string =>
  typeof v === "string" && (v === PAPERS_DIR || v.startsWith(`${PAPERS_DIR}/`)) && !v.split("/").some((s) => s === ".." || s === "." || s === "");

/** @returns the message when it is well formed, or null for anything a webview should never send */
export function parseSidebarMessage(raw: unknown): SidebarToHost | null {
  if (!raw || typeof raw !== "object") { return null; }
  const m = raw as Record<string, unknown>;
  if (PATH_KEYS.includes(m["type"] as string) && !isTreePath(m["path"])) { return null; }
  switch (m["type"]) {
    case "ready": case "refresh": case "openFolder": case "createFolder": case "addFiles": case "renameFolder": case "removeFolder":
      return m as SidebarToHost;
    case "searchTag": return typeof m["tag"] === "string" ? (m as SidebarToHost) : null;
    case "revealPaper": return typeof m["id"] === "string" ? (m as SidebarToHost) : null;
    case "import": return typeof m["uris"] === "string" ? (m as SidebarToHost) : null;
    case "openProject": return typeof m["id"] === "string" ? (m as SidebarToHost) : null;
    case "projectCommand":
      return typeof m["id"] === "string" && PROJECT_COMMANDS.some((c) => c.command === m["command"]) ? (m as SidebarToHost) : null;
    case "projectAction": return PROJECT_ACTIONS.includes(m["action"] as string) ? (m as SidebarToHost) : null;
    case "moveFolder": return isTreePath(m["target"]) ? (m as SidebarToHost) : null;
    default: return null;
  }
}
