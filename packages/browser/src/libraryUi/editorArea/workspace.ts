// Runs the library page's tabs over the core editor area: opens them lazily, keeps the URL hash in step and restores them on load.
import type { ILogger } from "@labshelf/core";
import {
  mountEditorArea,
  type EditorArea,
  type EditorAreaPrefsPort,
  type EditorGroupSide,
  type EditorTabView,
  type EditorTab,
} from "@labshelf/core/dom";
import { type PagePlan, isKindShown } from "../pagePlan";
import type { TabContext, TabKindName, TabParams } from "./tabKind";
import { createTabBodies, type TabBodies } from "./tabBodies";
import {
  isFolderHash,
  parseWorkspaceHash,
  type WorkspaceHashState,
  formatWorkspaceHash,
} from "./workspaceHash";
import { parseTab, TAB_KINDS } from "./tabKinds";

const STORED_HASH_KEY = "labshelf.library.tabs";

type HashStorage = Pick<Storage, "getItem" | "setItem">;

interface HashSync {
  write(): void;
  /** The tabs hash the session kept, or null. */
  stored(): string | null;
  isQuiet(): boolean;
  /** Runs `fn` with the hash left alone: a restore writes once at its end, and a hash change must not rewrite the hash it answers. */
  silently(fn: () => void): void;
}

function createHashSync(tabs: () => EditorTabView[], storage: HashStorage): HashSync {
  let quiet = false;
  return {
    write() {
      if (quiet) return;
      const open = tabs();
      const next = formatWorkspaceHash({ tabs: open.map((t) => t.id), active: open.find((t) => t.focused)?.id ?? null });
      try { storage.setItem(STORED_HASH_KEY, next); } catch { /* storage unavailable: the hash alone carries the tabs */ }
      if (location.hash === next) return;
      // A folder deep link is a history entry the user can come back to; a tabs hash is replaced in place.
      if (isFolderHash(location.hash)) history.pushState(null, "", next);
      else history.replaceState(null, "", next);
    },
    stored() {
      try { return storage.getItem(STORED_HASH_KEY); } catch { return null; }
    },
    isQuiet: () => quiet,
    silently(fn) {
      const was = quiet;
      quiet = true;
      try { fn(); } finally { quiet = was; }
    },
  };
}

interface TabOpener {
  open(kind: TabKindName, params?: TabParams, group?: EditorGroupSide, background?: boolean): void;
  setDirty(id: string, kind: TabKindName, params: TabParams, dirty: boolean): void;
}

function createTabOpener(area: () => EditorArea, bodies: () => TabBodies, hash: HashSync): TabOpener {
  const describe = (kind: TabKindName, params: TabParams, group: EditorGroupSide, dirty?: boolean): EditorTab => {
    const def = TAB_KINDS[kind];
    const id = def.id(params);
    return { id, title: def.title(params), icon: def.icon, group, dirty: dirty ?? area().tabs().find((t) => t.id === id)?.dirty === true, mount: (host) => bodies().mount(id, kind, params, host) };
  };

  return {
    open(kind, params = {}, group, background = false) {
      area().open(describe(kind, params, group ?? 0), group, { background });
    },
    // The area focuses a tab it updates, so the tabs showing and the focused one are put back afterwards.
    setDirty(id, kind, params, dirty) {
      const before = area().tabs();
      const tab = before.find((t) => t.id === id);
      if (!tab || tab.dirty === dirty) return;
      hash.silently(() => {
        area().open(describe(kind, params, tab.group, dirty), tab.group);
        for (const shown of before.filter((t) => t.active && !t.focused)) area().activate(shown.id);
        const focused = before.find((t) => t.focused);
        if (focused) area().activate(focused.id);
      });
    },
  };
}

interface RestorePlan extends WorkspaceHashState {
  /** True when the Library tab shows the folder the URL names, so the router's folder is left in place. */
  folderLink: boolean;
}

const LIBRARY = "library";

const shown = (plan: PagePlan, tabs: readonly string[]): string[] => tabs.filter((id) => isKindShown(plan, id.split(":")[0]!));

/** `stored` is the last tabs hash this browser tab wrote; it lets a folder deep link reload without losing the open tabs. Tabs of a hidden section are dropped. */
export function deriveRestorePlan(hash: string, stored: string | null, plan: PagePlan): RestorePlan {
  const fromHash = parseWorkspaceHash(hash);
  const listed = fromHash ? shown(plan, fromHash.tabs) : [];
  if (fromHash && listed.length > 0) return { tabs: listed, active: fromHash.active !== null && listed.includes(fromHash.active) ? fromHash.active : listed[0]!, folderLink: false };
  if (plan.library && isFolderHash(hash)) {
    const kept = shown(plan, (stored !== null ? parseWorkspaceHash(stored)?.tabs : undefined) ?? []);
    return { tabs: kept.includes(LIBRARY) ? kept : [LIBRARY, ...kept], active: LIBRARY, folderLink: true };
  }
  return { tabs: [plan.defaultTab], active: plan.defaultTab, folderLink: false };
}

function restoreTabs(target: string, area: EditorArea, opener: TabOpener, hash: HashSync, plan: PagePlan, logger: ILogger): void {
  const restored = deriveRestorePlan(target, hash.stored(), plan);
  hash.silently(() => {
    for (const id of restored.tabs) {
      const parsed = parseTab(id);
      if (parsed) opener.open(parsed.kind, parsed.params, undefined, true);
      else void logger.log("WARN", "libraryUi.editorArea", "dropped a tab id no kind reads", { id });
    }
    if (area.tabs().length === 0) opener.open(plan.defaultTab);
    const active = area.tabs().some((t) => t.id === restored.active) ? restored.active : plan.defaultTab;
    if (active !== null) area.activate(active);
  });
  if (!restored.folderLink) hash.write();
}

export interface Workspace {
  /** Opens the tab (or focuses it when open); `group` places a new tab in that editor group. */
  openTab(kind: TabKindName, params?: TabParams, group?: EditorGroupSide): void;
  /** Closes every open tab whose id matches; resolves false when one stayed open. */
  closeTabs(predicate: (id: string) => boolean): Promise<boolean>;
  tabs(): EditorTabView[];
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
