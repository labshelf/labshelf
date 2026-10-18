// Declares a tab kind of the library page's workspace, the module its body chunk exports and what a body receives.
import type { ILogger, IconName, LibraryFileSystem } from "@labshelf/core";
import type { EditorTabBody } from "@labshelf/core/dom";
import type { PagePrefs } from "../prefs";
import type { ProjectSession } from "../session";
import type { Workspace } from "../workspace";

export type TabKindName = "library" | "all-projects" | "templates" | "source" | "preview";

export type TabParams = Readonly<Record<string, string>>;

export interface TabContext {
  /** The library UI, mounted once at page level so the sidebar's Library section follows its store. */
  libraryView: HTMLElement;
  workspace: Workspace;
  logger: ILogger;
  /** The library folder, shared by every tab so they read one cache. */
  fs: LibraryFileSystem;
  prefs: PagePrefs;
  session: ProjectSession;
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
