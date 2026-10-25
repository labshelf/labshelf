// Registers the workspace tab kinds and turns a tab id back into its kind and params.
import type { TabKind, TabKindName, TabModule, TabParams } from "./tabKind";

// INVARIANT: an id is the kind, then each param URI-encoded, joined by ":"; encoding keeps ":" out of the params.
function define(kind: TabKindName, params: readonly string[], title: (p: TabParams) => string, icon: TabKind["icon"], load: () => Promise<TabModule>): TabKind {
  const id = (p: TabParams): string => [kind, ...params.map((name) => encodeURIComponent(p[name] ?? ""))].join(":");
  return { kind, params, id, title, icon, load };
}

const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

// Each body is a dynamic import, so the bundler emits it as its own chunk and the page loads it on first open.
export const TAB_KINDS: Record<TabKindName, TabKind> = {
  spaces: define("spaces", [], () => "All Spaces", "grid", () => import("./spacesCatalogTab.js")),
  space: define("space", ["id", "tab"], () => "Space", "folder", () => import("./spacesPageTab.js")),
  library: define("library", [], () => "Library", "book-open", () => import("./libraryTab.js")),
  "all-projects": define("all-projects", [], () => "All projects", "folder", () => import("./projectListTab.js")),
  templates: define("templates", [], () => "Templates", "grid", () => import("./templatesTab.js")),
  source: define("source", ["projectId", "path"], (p) => baseName(p["path"] ?? ""), "file-text", () => import("./sourceTab.js")),
  preview: define("preview", ["projectId"], () => "Preview", "file", () => import("./previewTab.js")),
  comments: define("comments", ["projectId"], () => "Comments", "message", () => import("./commentsTab.js")),
  history: define("history", ["projectId"], () => "History", "history", () => import("./historyTab.js")),
  search: define("search", ["projectId"], () => "Search", "search", () => import("./searchTab.js")),
};

const isKindName = (name: string): name is TabKindName => Object.hasOwn(TAB_KINDS, name);

/** Reads a tab id; null when its kind is unknown, its param count is wrong or a param is badly encoded. */
export function parseTab(id: string): { kind: TabKindName; params: TabParams } | null {
  const [kind, ...parts] = id.split(":");
  if (kind === undefined || !isKindName(kind) || parts.length !== TAB_KINDS[kind].params.length) return null;
  try {
    return { kind, params: Object.fromEntries(TAB_KINDS[kind].params.map((name, i) => [name, decodeURIComponent(parts[i]!)])) };
  } catch {
    return null;
  }
}
