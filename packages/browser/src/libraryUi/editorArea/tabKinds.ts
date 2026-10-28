// Declares what a browser tab body gets and exports, and registers each kind's body next to its core spec.
import { TAB_KIND_SPECS } from "@labshelf/core";
import type { ILogger, LibraryFileSystem, SelectionHub, ShareHost, TabKindName, TabKindSpec, TabParams } from "@labshelf/core";
import type { EditorTabBody } from "@labshelf/core/dom";
import type { CommentThreads, PageShare } from "../../collab";
import type { HelperProject } from "@labshelf/core/helper";
import type { PagePrefs } from "../prefs";
import type { ProjectSession } from "../../writing";
import type { PageSpaces } from "../spaces";
import type { Workspace } from "./workspace";

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

export interface TabKind extends TabKindSpec {
  load(): Promise<TabModule>;
}

const define = (kind: TabKindName, load: () => Promise<TabModule>): TabKind => ({ ...TAB_KIND_SPECS[kind], load });

// Each body is a dynamic import, so the bundler emits it as its own chunk and the page loads it on first open.
export const TAB_KINDS: Record<TabKindName, TabKind> = {
  spaces: define("spaces", () => import("./spacesCatalogTab.js")),
  space: define("space", () => import("./spacesPageTab.js")),
  library: define("library", () => import("./libraryTab.js")),
  "all-projects": define("all-projects", () => import("./projectListTab.js")),
  templates: define("templates", () => import("./templatesTab.js")),
  source: define("source", () => import("./sourceTab.js")),
  preview: define("preview", () => import("./previewTab.js")),
  comments: define("comments", () => import("./commentsTab.js")),
  history: define("history", () => import("./historyTab.js")),
  search: define("search", () => import("./searchTab.js")),
};
