// Declares the workspace tab kinds with their ids, titles and icons, turns a tab id back into its kind and params, and binds a folder to a URL hash.
import { PAPERS_DIR } from "../library/index.js";
import { baseName, isLibraryPath } from "../path/index.js";
import type { IconName } from "../ui/index.js";

export type TabKindName = "library" | "spaces" | "space" | "all-projects" | "templates" | "source" | "preview" | "comments" | "history" | "search";

export type TabParams = Readonly<Record<string, string>>;

/** What a tab kind is, apart from the body an app mounts for it. */
export interface TabKindSpec {
  kind: TabKindName;
  /** The param names, in the order the tab id carries them. */
  params: readonly string[];
  id(params: TabParams): string;
  title(params: TabParams): string;
  icon: IconName;
}

// INVARIANT: an id is the kind, then each param URI-encoded, joined by ":"; encoding keeps ":" out of the params.
function define(kind: TabKindName, params: readonly string[], title: (p: TabParams) => string, icon: IconName): TabKindSpec {
  const id = (p: TabParams): string => [kind, ...params.map((name) => encodeURIComponent(p[name] ?? ""))].join(":");
  return { kind, params, id, title, icon };
}

export const TAB_KIND_SPECS: Record<TabKindName, TabKindSpec> = {
  spaces: define("spaces", [], () => "All Spaces", "grid"),
  space: define("space", ["id", "tab"], () => "Space", "folder"),
  library: define("library", [], () => "Library", "book-open"),
  "all-projects": define("all-projects", [], () => "All projects", "folder"),
  templates: define("templates", [], () => "Templates", "grid"),
  source: define("source", ["projectId", "path"], (p) => baseName(p["path"] ?? ""), "file-text"),
  preview: define("preview", ["projectId"], () => "Preview", "file"),
  comments: define("comments", ["projectId"], () => "Comments", "message"),
  history: define("history", ["projectId"], () => "History", "history"),
  search: define("search", ["projectId"], () => "Search", "search"),
};

const isKindName = (name: string): name is TabKindName => Object.hasOwn(TAB_KIND_SPECS, name);

/** Reads a tab id; null when its kind is unknown, its param count is wrong or a param is badly encoded. */
export function parseTab(id: string): { kind: TabKindName; params: TabParams } | null {
  const [kind, ...parts] = id.split(":");
  if (kind === undefined || !isKindName(kind) || parts.length !== TAB_KIND_SPECS[kind].params.length) return null;
  try {
    return { kind, params: Object.fromEntries(TAB_KIND_SPECS[kind].params.map((name, i) => [name, decodeURIComponent(parts[i]!)])) };
  } catch {
    return null;
  }
}

/** Parses a location hash into a folder path, falling back to the root. */
export function parseFolderHash(hash: string): string {
  const raw = decodeURIComponent(hash.replace(/^#\/?/, "")).replace(/\/+$/, "");
  return isLibraryPath(raw) ? raw : PAPERS_DIR;
}

/** Builds the hash for a folder path. */
export function createFolderHash(folder: string): string {
  return `#/${folder.split("/").map(encodeURIComponent).join("/")}`;
}

/** The page title for the open folder. */
export function createFolderTitle(folder: string): string {
  return folder === PAPERS_DIR ? "LabShelf" : `${baseName(folder)} — LabShelf`;
}
