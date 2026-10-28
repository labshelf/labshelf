// Declares the workspace tab kinds, registers them and turns a tab id back into its kind and params.
import { baseName } from "@labshelf/core";
import type { ILogger, IconName, LibraryFileSystem, SelectionHub, ShareHost } from "@labshelf/core";
import type { EditorTabBody } from "@labshelf/core/dom";
import type { CommentThreads, PageShare } from "../../collab";
import type { HelperProject } from "../../helper";
import type { PagePrefs } from "../prefs";
import type { ProjectSession } from "../../writing/session";
import type { PageSpaces } from "../spaces";
import type { Workspace } from "./workspace";

export type TabKindName = "library" | "spaces" | "space" | "all-projects" | "templates" | "source" | "preview" | "comments" | "history" | "search";

export type TabParams = Readonly<Record<string, string>>;

/** What a tab body can tell the workspace about its own tab. */
export interface TabHooks {
  /** Shows or clears the unsaved dot on the tab. */
  setDirty(dirty: boolean): void;
  /** Replaces the handler that runs before the tab closes; it resolves false to keep the tab open (a failed save). */
  onBeforeClose(handler: () => Promise<boolean> | boolean): void;
}

/** What only project tabs use; created when the page loads its project wiring. */
export interface ProjectServices {
  session: ProjectSession;
  helperProject: HelperProject;
  /** The open project's comment threads, shared by every tab. */
  comments: CommentThreads;
  /** The shared projects of this page: their connections and the share workflows. */
  sharing: PageShare;
}

export interface TabContext {
  spaces: PageSpaces;
  /** The library UI, mounted once at page level so the sidebar's Library section follows its store. */
  libraryView: HTMLElement;
  workspace: Workspace;
  tab: TabHooks;
  logger: ILogger;
  /** The library folder, shared by every tab so they read one cache. */
  fs: LibraryFileSystem;
  prefs: PagePrefs;
  /** Where a tab reports what the user selected, for the Details pane. */
  selection: SelectionHub;
  /** The library page's sharing operations, which the All projects tab hands to its menus. */
  sharing: ShareHost;
  /** The project services; throws when the page has not loaded them, which only a project tab on a page without Projects would hit. */
  project(): ProjectServices;
}

/** What each tab body chunk (`tabs/<kind>/index.ts`) exports. */
export interface TabModule {
  mountTab(el: HTMLElement, params: TabParams, ctx: TabContext): EditorTabBody;
}

export interface TabKind {
  kind: TabKindName;
  /** The param names, in the order the tab id carries them. */
  params: readonly string[];
  id(params: TabParams): string;
  title(params: TabParams): string;
  icon: IconName;
  load(): Promise<TabModule>;
}

// INVARIANT: an id is the kind, then each param URI-encoded, joined by ":"; encoding keeps ":" out of the params.
function define(kind: TabKindName, params: readonly string[], title: (p: TabParams) => string, icon: TabKind["icon"], load: () => Promise<TabModule>): TabKind {
  const id = (p: TabParams): string => [kind, ...params.map((name) => encodeURIComponent(p[name] ?? ""))].join(":");
  return { kind, params, id, title, icon, load };
}

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
