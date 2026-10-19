// Runs the library page's tabs over the core editor area: opens them lazily, keeps the URL hash in step and restores them on load.
import type { ILogger } from "@labshelf/core";
import { el, mountEditorArea, type EditorArea, type EditorAreaPrefsPort, type EditorGroupIndex, type EditorTab, type EditorTabBody, type EditorTabInfo } from "@labshelf/core/dom";
import type { PagePlan } from "../sections";
import { TAB_KINDS, parseTabId, type TabContext, type TabHooks, type TabKindName, type TabParams } from "../tabs";
import { planRestore } from "./restorePlan";
import { formatWorkspaceHash, isFolderHash } from "./workspaceHash";

const MODULE = "library-page.workspace";
const STORED_HASH_KEY = "labshelf.library.tabs";

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
  storage?: Pick<Storage, "getItem" | "setItem">;
}

function readStored(storage: Pick<Storage, "getItem">): string | null {
  try { return storage.getItem(STORED_HASH_KEY); } catch { return null; }
}

export function createWorkspace(slot: HTMLElement, { prefs, services, logger, plan, storage = sessionStorage }: WorkspaceOptions): Workspace {
  // While true the hash is left alone: a restore writes once at its end, and a hash change must not rewrite the hash it answers.
  let quiet = false;
  let area: EditorArea;

  const writeHash = (): void => {
    if (quiet) return;
    const tabs = area.tabs();
    const next = formatWorkspaceHash({ tabs: tabs.map((t) => t.id), active: tabs.find((t) => t.focused)?.id ?? null });
    try { storage.setItem(STORED_HASH_KEY, next); } catch { /* storage unavailable: the hash alone carries the tabs */ }
    if (location.hash === next) return;
    // A folder deep link is a history entry the user can come back to; a tabs hash is replaced in place.
    if (isFolderHash(location.hash)) history.pushState(null, "", next);
    else history.replaceState(null, "", next);
  };

  // One handler per tab id: a body replaces its own, and the area asks it before the tab closes.
  const beforeClose = new Map<string, () => Promise<boolean> | boolean>();

  const tabHooks = (id: string, kind: TabKindName, params: TabParams): TabHooks => ({
    setDirty: (dirty) => setDirty(id, kind, params, dirty),
    onBeforeClose: (handler) => { beforeClose.set(id, handler); },
  });

  const mountBody = (id: string, kind: TabKindName, params: TabParams, host: HTMLElement): EditorTabBody => {
    let disposed = false;
    let body: EditorTabBody | null = null;
    TAB_KINDS[kind].load()
      .then((module) => {
        if (disposed) return;
        body = module.mountTab(host, params, { ...services(), workspace, tab: tabHooks(id, kind, params) });
        area.refreshActions(id);
      })
      .catch((error: unknown) => {
        void logger.error(MODULE, error, { action: "mountTab", kind });
        host.append(el("p", { class: "ls-workspace-placeholder", role: "alert" }, `Could not load the ${TAB_KINDS[kind].title(params)} tab.`));
      });
    return {
      get actions() { return body?.actions ?? []; },
      dispose: () => { disposed = true; beforeClose.delete(id); body?.dispose(); },
    };
  };

  // A tab opened again keeps the dirty mark its body set.
  const describe = (kind: TabKindName, params: TabParams, group: EditorGroupIndex, dirty?: boolean): EditorTab => {
    const def = TAB_KINDS[kind];
    const id = def.id(params);
    return { id, title: def.title(params), icon: def.icon, group, dirty: dirty ?? area.tabs().find((t) => t.id === id)?.dirty === true, mount: (host) => mountBody(id, kind, params, host) };
  };

  function open(kind: TabKindName, params: TabParams = {}, group?: EditorGroupIndex, background = false): void {
    area.open(describe(kind, params, group ?? 0), group, { background });
  }

  // The area focuses a tab it updates, so the tabs showing and the focused one are put back afterwards.
  function setDirty(id: string, kind: TabKindName, params: TabParams, dirty: boolean): void {
    const before = area.tabs();
    const tab = before.find((t) => t.id === id);
    if (!tab || tab.dirty === dirty) return;
    const wasQuiet = quiet;
    quiet = true;
    area.open(describe(kind, params, tab.group, dirty), tab.group);
    for (const shown of before.filter((t) => t.active && !t.focused)) area.activate(shown.id);
    const focused = before.find((t) => t.focused);
    if (focused) area.activate(focused.id);
    quiet = wasQuiet;
  }

  // A dirty tab is still being saved, so leaving the page asks first (the editor also writes on pagehide).
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (area.tabs().some((t) => t.dirty)) { event.preventDefault(); event.returnValue = ""; }
  };
  window.addEventListener("beforeunload", onBeforeUnload);

  area = mountEditorArea(slot, {
    onActivate: writeHash,
    onMove: writeHash,
    prefs,
    onClose: async (id) => {
      const handler = beforeClose.get(id);
      if (handler) {
        // A handler that throws keeps the tab open: closing could drop unsaved work.
        const closable = await (async () => handler())().catch((error: unknown) => {
          void logger.error(MODULE, error, { action: "beforeClose", id });
          return false;
        });
        if (!closable) return false;
      }
      // The area removes the tab after this returns, so the hash is written once the tab list has settled.
      setTimeout(writeHash, 0);
      return true;
    },
  });

  // A folder deep link focuses the Library without rewriting the hash, so back and forward keep walking the history.
  const onHashChange = (): void => {
    if (quiet || !plan.library || !isFolderHash(location.hash)) return;
    quiet = true;
    open("library");
    quiet = false;
  };
  window.addEventListener("hashchange", onHashChange);

  const workspace: Workspace = {
    openTab: (kind, params, group) => { open(kind, params, group); writeHash(); },
    async closeTabs(predicate) {
      const results = await Promise.all(area.tabs().filter((t) => predicate(t.id)).map((t) => area.close(t.id)));
      return results.every(Boolean);
    },
    tabs: () => area.tabs(),
    restore(hash) {
      const restored = planRestore(hash, readStored(storage), plan);
      quiet = true;
      for (const id of restored.tabs) {
        const parsed = parseTabId(id);
        if (parsed) open(parsed.kind, parsed.params, undefined, true);
        else void logger.log("WARN", MODULE, "dropped a tab id no kind reads", { id });
      }
      if (area.tabs().length === 0) open(plan.defaultTab);
      const active = area.tabs().some((t) => t.id === restored.active) ? restored.active : plan.defaultTab;
      if (active !== null) area.activate(active);
      quiet = false;
      if (!restored.folderLink) writeHash();
    },
    dispose: () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
      area.dispose();
    },
  };
  return workspace;
}
