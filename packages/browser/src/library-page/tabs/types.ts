// Declares a tab kind of the library page's workspace, the module its body chunk exports and what a body receives.
import type { ILogger, IconName, LibraryFileSystem } from "@labshelf/core";
import type { EditorTabBody } from "@labshelf/core/dom";
import type { PageShares } from "../editor/collab";
import type { HelperProject } from "../helperProject";
import type { PagePrefs } from "../prefs";
import type { CommentThreads } from "../review";
import type { ProjectSession } from "../session";
import type { Workspace } from "../workspace";

export type TabKindName = "library" | "all-projects" | "templates" | "source" | "preview" | "comments" | "history";

export type TabParams = Readonly<Record<string, string>>;

/** What a tab body can tell the workspace about its own tab. */
export interface TabHooks {
  /** Shows or clears the unsaved dot on the tab. */
  setDirty(dirty: boolean): void;
  /** Replaces the handler that runs before the tab closes; it resolves false to keep the tab open (a failed save). */
  onBeforeClose(handler: () => Promise<boolean> | boolean): void;
}

export interface TabContext {
  /** The library UI, mounted once at page level so the sidebar's Library section follows its store. */
  libraryView: HTMLElement;
  workspace: Workspace;
  tab: TabHooks;
  logger: ILogger;
  /** The library folder, shared by every tab so they read one cache. */
  fs: LibraryFileSystem;
  prefs: PagePrefs;
  session: ProjectSession;
  helperProject: HelperProject;
  /** The open project's comment threads, shared by every tab. */
  comments: CommentThreads;
  /** The live connections of the shared projects joined on this page. */
  shares: PageShares;
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
