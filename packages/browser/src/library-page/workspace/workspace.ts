// Runs the library page's tabs over the core editor area: opens them lazily, keeps the URL hash in step and restores them on load.
import type { ILogger } from "@labshelf/core";
import { mountEditorArea, type EditorArea, type EditorAreaPrefsPort, type EditorGroupIndex, type EditorTabInfo } from "@labshelf/core/dom";
import type { PagePlan } from "../sections";
import type { TabContext, TabKindName, TabParams } from "../tabs";
import { restoreTabs } from "./restoreTabs";
import { createTabOpener } from "./tabOpener";
import { createHashSync, type HashStorage } from "./hashSync";
import { createTabBodies } from "./tabBodies";
import { isFolderHash } from "./workspaceHash";

export interface Workspace {
  /** Opens the tab (or focuses it when open); `group` places a new tab in that editor group. */
  openTab(kind: TabKindName, params?: TabParams, group?: EditorGroupIndex): void;
  /** Closes every open tab whose id matches; resolves false when one stayed open. */
  closeTabs(predicate: (id: string) => boolean): Promise<boolean>;
  tabs(): EditorTabInfo[];
  /** Opens the tabs a page hash (or the tabs kept for the session) names, else the plan's default tab. */
  restore(hash: string): void;
  dispose(): void;
}

export interface WorkspaceOptions {
  prefs: EditorAreaPrefsPort;
  /** What every tab body receives besides the workspace; read when a body mounts, so it may name objects created after the workspace. */
  services: () => Omit<TabContext, "workspace" | "tab">;
  logger: ILogger;
  /** The sections the page shows: tabs of a hidden section are never opened, and the default tab comes from it. */
  plan: PagePlan;
  /** Where the last tabs hash is kept for the session; defaults to sessionStorage. */
  storage?: HashStorage;
  /** Kept at the end of the right-most group's titlebar (the Details toggle). */
  trailing?: HTMLElement;
  /** Runs with the id of every tab that gains focus. */
  onActivateTab?: (tabId: string) => void;
}

export function createWorkspace(slot: HTMLElement, { prefs, services, logger, plan, storage = sessionStorage, trailing, onActivateTab }: WorkspaceOptions): Workspace {
  let area: EditorArea;
  const hash = createHashSync(() => area.tabs(), storage);
  const opener = createTabOpener(() => area, () => bodies, hash);
  const bodies = createTabBodies({ logger, services, workspace: () => workspace, setDirty: opener.setDirty, refreshActions: (id) => area.refreshActions(id) });

  // A dirty tab is still being saved, so leaving the page asks first (the editor also writes on pagehide).
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (area.tabs().some((t) => t.dirty)) { event.preventDefault(); event.returnValue = ""; }
  };
  window.addEventListener("beforeunload", onBeforeUnload);

  area = mountEditorArea(slot, {
    onActivate: (id) => { hash.write(); onActivateTab?.(id); },
    onMove: hash.write,
    prefs,
    ...(trailing ? { trailing } : {}),
    onClose: async (id) => {
      if (!(await bodies.confirmClose(id))) return false;
      // The area removes the tab after this returns, so the hash is written once the tab list has settled.
      setTimeout(hash.write, 0);
      return true;
    },
  });

  // A folder deep link focuses the Library without rewriting the hash, so back and forward keep walking the history.
  const onHashChange = (): void => {
    if (hash.isQuiet() || !plan.library || !isFolderHash(location.hash)) return;
    hash.silently(() => opener.open("library"));
  };
  window.addEventListener("hashchange", onHashChange);

  const workspace: Workspace = {
    openTab: (kind, params, group) => { opener.open(kind, params, group); hash.write(); },
    async closeTabs(predicate) {
      const results = await Promise.all(area.tabs().filter((t) => predicate(t.id)).map((t) => area.close(t.id)));
      return results.every(Boolean);
    },
    tabs: () => area.tabs(),
    restore: (target) => restoreTabs(target, area, opener, hash, plan, logger),
    dispose: () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
      area.dispose();
    },
  };
  return workspace;
}
