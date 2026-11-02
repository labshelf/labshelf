// Declares what a browser tab body gets and exports, and registers each kind's body next to its core spec.
import { TAB_KIND_SPECS } from "@labshelf/core";
import type { ProjectNotesStore, ILogger, QmdViewStatePort, LibraryFileSystem, SelectionHub, ShareHost, TabKindName, TabKindSpec, TabParams } from "@labshelf/core";
import { renderElement, type EditorTabBody } from "@labshelf/core/dom";
import { createReaderUrl } from "../reader";
import type { CommentThreads, PageShare, ProjectSuggestions } from "../../collab";
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
  /** The open project's suggestions for the editor's review mode, shared by every tab. */
  suggestions: ProjectSuggestions;
  /** The shared projects of this page: their connections and the share workflows. */
  sharing: PageShare;
  /** The page's project notes store, which a project note's tab saves through. */
  notes: ProjectNotesStore;
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
  /** Where a note tab keeps how its items are shown (collapsed cells and sections, Reading mode); absent in tests that do not need it. */
  noteViewState?: QmdViewStatePort;
}

/** What each tab body chunk (`tabs/<kind>/index.ts`) exports. */
export interface TabModule {
  mountTab(el: HTMLElement, params: TabParams, ctx: TabContext): EditorTabBody;
}

export interface TabKind extends TabKindSpec {
  load(): Promise<TabModule>;
}

/** The notes the notes store lists live in the project's `notes` folder. */
const isProjectNotePath = (path: string | undefined): boolean => path !== undefined && path.startsWith("notes/") && path.endsWith(".qmd");

/** A project note opens in the note editor, a deck's deck.html in the deck tab and any other source file in the source editor; the chunks load on the first source tab (the deck editor itself loads only with a deck). */
async function loadSource(): Promise<TabModule> {
  const [{ mountTab: mountSource }, { mountNoteFileTab }, { mountTab: mountDeck, isDeckPath }] = await Promise.all([import("./sourceTab.js"), import("./noteFileTab.js"), import("./deckTab.js")]);
  /** Shows a project note: every item of the file in the shared note view, saved through the project notes store, its cells run in the project folder. */
  const mountNote: TabModule["mountTab"] = (host, params, ctx) => {
    const projectId = params["projectId"] ?? "";
    const path = params["path"] ?? "";
    const notes = () => ctx.project().notes;
    return mountNoteFileTab(host, ctx, {
      label: path,
      // The D2 note key: the cells of one project note share a process per language.
      noteKey: `project:${projectId}:${path}`,
      read: () => notes().read(projectId, path),
      editItem: (itemId, body) => notes().editItem(projectId, path, itemId, body),
      runCell: (ports) => ports.runCellIn(projectId),
    });
  };
  return {
    mountTab: (el, params, ctx) => {
      const path = params["path"];
      if (path !== undefined && isDeckPath(path)) return mountDeck(el, params, ctx);
      return (isProjectNotePath(path) ? mountNote : mountSource)(el, params, ctx);
    },
  };
}

const define = (kind: TabKindName, load: () => Promise<TabModule>): TabKind => ({ ...TAB_KIND_SPECS[kind], load });

let paperTitle: (paperId: string) => string | undefined = () => undefined;

/** Names paper tabs after their paper; a tab opened before the library has loaded keeps the spec's title. */
export function setPaperTitles(lookup: (paperId: string) => string | undefined): void {
  paperTitle = lookup;
}

/** Shows a paper's PDF as a tab of the library page: the reader page in a frame, so it keeps its own pdf.js, host and keys. */
const loadPaper = async (): Promise<TabModule> => ({
  mountTab: (host, params) => {
    const frame = renderElement("iframe", { class: "ls-workspace-fill ls-paper-frame", src: createReaderUrl(params["paperId"] ?? ""), title: "PDF reader" });
    host.append(frame);
    return { dispose: () => frame.remove() };
  },
});

// Each body is a dynamic import, so the bundler emits it as its own chunk and the page loads it on first open.
export const TAB_KINDS: Record<TabKindName, TabKind> = {
  spaces: define("spaces", () => import("./spacesCatalogTab.js")),
  space: define("space", () => import("./spacesPageTab.js")),
  library: define("library", () => import("./libraryTab.js")),
  "all-projects": define("all-projects", () => import("./projectListTab.js")),
  templates: define("templates", () => import("./templatesTab.js")),
  source: define("source", loadSource),
  preview: define("preview", () => import("./previewTab.js")),
  comments: define("comments", () => import("./commentsTab.js")),
  history: define("history", () => import("./historyTab.js")),
  search: define("search", () => import("./searchTab.js")),
  paper: { ...define("paper", loadPaper), title: (p) => paperTitle(p["paperId"] ?? "") ?? TAB_KIND_SPECS.paper.title(p) },
  "paper-notes": {
    ...define("paper-notes", async () => ({ mountTab: (await import("./noteFileTab.js")).mountPaperNoteTab })),
    title: (p) => { const title = paperTitle(p["paperId"] ?? ""); return title ? `Notes: ${title}` : TAB_KIND_SPECS["paper-notes"].title(p); },
  },
  deck: define("deck", () => import("./deckTab.js")),
};
