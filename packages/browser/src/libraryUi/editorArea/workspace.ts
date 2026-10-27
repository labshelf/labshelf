// Runs the library page's tabs over the core editor area: opens them lazily, keeps the URL hash in step, restores them on load and frames them with the page shell.
import { PANE_LIMITS, PAPERS_DIR, type ILogger } from "@labshelf/core";
import {
  attachSash,
  mountEditorArea,
  renderElement,
  type EditorArea,
  type EditorAreaPrefsPort,
  type EditorAreaSide,
  type EditorTab,
  type EditorTabBody,
  type EditorTabView,
} from "@labshelf/core/dom";
import { type PagePlan, isKindShown } from "../pagePlan";
import type { PagePrefs } from "../prefs";
import { parseTab, TAB_KINDS, type TabContext, type TabHooks, type TabKindName, type TabParams } from "./tabKinds";

// --- Tab hash: the page hash that lists the open tabs and the active one (`#/tabs/library,templates;active=library`) ---

const TABS_PREFIX = "#/tabs/";
const ACTIVE_MARK = ";active=";

export interface WorkspaceHashState {
  tabs: string[];
  active: string | null;
}

export function formatWorkspaceHash({ tabs, active }: WorkspaceHashState): string {
  return `${TABS_PREFIX}${tabs.map(encodeURIComponent).join(",")}${active === null ? "" : ACTIVE_MARK + encodeURIComponent(active)}`;
}

const decode = (part: string): string | null => {
  try { return decodeURIComponent(part); } catch { return null; }
};

/** Reads a tabs hash; null for any other hash. A badly encoded id is dropped, and so is an active id that is not open. */
export function parseWorkspaceHash(hash: string): WorkspaceHashState | null {
  if (!hash.startsWith(TABS_PREFIX)) return null;
  const body = hash.slice(TABS_PREFIX.length);
  const split = body.indexOf(ACTIVE_MARK);
  const list = split === -1 ? body : body.slice(0, split);
  const tabs = list.split(",").filter((part) => part !== "").flatMap((part) => decode(part) ?? []);
  const active = split === -1 ? null : decode(body.slice(split + ACTIVE_MARK.length));
  return { tabs, active: active !== null && tabs.includes(active) ? active : null };
}

/** True for a folder deep link (`#/papers/...`), the hash the library router writes. */
export const isFolderHash = (hash: string): boolean => hash === `#/${PAPERS_DIR}` || hash.startsWith(`#/${PAPERS_DIR}/`);

export const JOIN_PREFIX = "#/join/";

/** The invite a join link carries in its fragment, which never reaches a server; undefined for any other hash. */
export function extractJoinInvite(hash: string): string | undefined {
  if (!hash.startsWith(JOIN_PREFIX)) return undefined;
  const invite = decode(hash.slice(JOIN_PREFIX.length));
  return invite === null || invite === "" ? undefined : invite;
}

// --- Tab bodies: mounted lazily, with the close guards the bodies register ---

const MODULE = "libraryUi.editorArea";

export interface TabBodies {
  mount(id: string, kind: TabKindName, params: TabParams, host: HTMLElement): EditorTabBody;
  /** True when the tab may close: its body's guard agrees, or it has none. */
  confirmClose(id: string): Promise<boolean>;
}

export interface TabBodiesDeps {
  logger: ILogger;
  services: () => Omit<TabContext, "workspace" | "tab">;
  workspace: () => Workspace;
  setDirty(id: string, kind: TabKindName, params: TabParams, dirty: boolean): void;
  refreshActions(id: string): void;
}

export function createTabBodies({ logger, services, workspace, setDirty, refreshActions }: TabBodiesDeps): TabBodies {
  // One handler per tab id: a body replaces its own, and the area asks it before the tab closes.
  const beforeClose = new Map<string, () => Promise<boolean> | boolean>();

  const hooks = (id: string, kind: TabKindName, params: TabParams): TabHooks => ({
    setDirty: (dirty) => setDirty(id, kind, params, dirty),
    onBeforeClose: (handler) => { beforeClose.set(id, handler); },
  });

  return {
    mount(id, kind, params, host) {
      let disposed = false;
      let body: EditorTabBody | null = null;
      TAB_KINDS[kind].load()
        .then((module) => {
          if (disposed) return;
          body = module.mountTab(host, params, { ...services(), workspace: workspace(), tab: hooks(id, kind, params) });
          refreshActions(id);
        })
        .catch((error: unknown) => {
          void logger.error(MODULE, error, { action: "mountTab", kind });
          host.append(renderElement("p", { class: "ls-workspace-placeholder", role: "alert" }, `Could not load the ${TAB_KINDS[kind].title(params)} tab.`));
        });
      return {
        get actions() { return body?.actions ?? []; },
        dispose: () => { disposed = true; beforeClose.delete(id); body?.dispose(); },
      };
    },
    async confirmClose(id) {
      const handler = beforeClose.get(id);
      if (!handler) return true;
      // A handler that throws keeps the tab open: closing could drop unsaved work.
      return (async () => handler())().catch((error: unknown) => {
        void logger.error(MODULE, error, { action: "beforeClose", id });
        return false;
      });
    },
  };
}

// --- Workspace ---

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
  open(kind: TabKindName, params?: TabParams, group?: EditorAreaSide, background?: boolean): void;
  setDirty(id: string, kind: TabKindName, params: TabParams, dirty: boolean): void;
}

function createTabOpener(area: () => EditorArea, bodies: () => TabBodies, hash: HashSync): TabOpener {
  const describe = (kind: TabKindName, params: TabParams, group: EditorAreaSide, dirty?: boolean): EditorTab => {
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
  openTab(kind: TabKindName, params?: TabParams, group?: EditorAreaSide): void;
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

// --- Page shell: the sidebar, centre and persistent right pane around the workspace ---

export interface PageShell {
  root: HTMLElement;
  sidebar: HTMLElement;
  centre: HTMLElement;
  details: HTMLElement;
  chat: HTMLElement;
  togglePane(pane: "details" | "chat"): void;
}

const DETAILS_COLLAPSED = "details-collapsed";
const DETAILS_LIMITS = { min: 260, max: 760, collapseAt: 180 };

export function createPageShell(host: HTMLElement, prefs: PagePrefs): PageShell {
  const saved = { ...prefs.load(), ...prefs.detailPane() };
  const root = renderElement("div", { class: "ls-library has-sidebar ls-pane-frame" });
  const sidebar = renderElement("aside", { class: "sidebar", "aria-label": "Library" });
  const sash = renderElement("div", { class: "sash sash-sidebar", title: "Drag to resize" });
  const centre = renderElement("div", { class: "ls-workspace-centre" });
  const right = renderElement("aside", { class: "ls-page-details ls-pane", "aria-label": "Details" });
  const details = renderElement("div", { class: "ls-workspace-fill" });
  const chat = renderElement("div", { class: "ls-workspace-fill" });
  right.append(details, chat);
  const show = (pane: "details" | "chat"): void => {
    details.hidden = pane !== "details";
    chat.hidden = pane !== "chat";
    root.dataset["rightPane"] = pane;
    right.setAttribute("aria-label", pane === "chat" ? "Research chat" : "Details");
  };
  show(saved.rightPane);
  const detailSash = renderElement("div", { class: "sash sash-detail", title: "Drag to resize" });
  // INVARIANT: An undragged right pane follows the sidebar width within its own minimum.
  const detailDefault = Math.max(DETAILS_LIMITS.min, saved.sidebarWidth);
  sidebar.style.width = `${saved.sidebarWidth}px`;
  right.style.width = `${saved.detailWidth ?? detailDefault}px`;
  root.classList.toggle("sidebar-collapsed", saved.sidebarCollapsed);
  root.classList.toggle(DETAILS_COLLAPSED, saved.detailCollapsed);
  attachSash(sash, {
    root, pane: sidebar, collapsedClass: "sidebar-collapsed", limits: PANE_LIMITS.sidebar,
    widthFromPointer: (x) => x - root.getBoundingClientRect().left,
    persist: (sidebarWidth, sidebarCollapsed) => prefs.save({ sidebarWidth, sidebarCollapsed }),
  });
  attachSash(detailSash, {
    root, pane: right, collapsedClass: DETAILS_COLLAPSED, limits: DETAILS_LIMITS, defaultWidth: detailDefault,
    widthFromPointer: (x) => root.getBoundingClientRect().right - x,
    persist: (detailWidth, detailCollapsed) => prefs.saveDetailPane({ detailWidth, detailCollapsed }),
  });
  root.append(sidebar, sash, centre, detailSash, right);
  const titlebar = renderElement("header", { class: "ls-workspace-titlebar", "aria-hidden": "true" });
  const statusbar = renderElement("footer", { class: "ls-workspace-statusbar", "aria-hidden": "true" });
  host.append(titlebar, root, statusbar);
  const togglePane = (pane: "details" | "chat"): void => {
    const collapsed = root.dataset["rightPane"] === pane && !root.classList.contains(DETAILS_COLLAPSED);
    show(pane);
    root.classList.toggle(DETAILS_COLLAPSED, collapsed);
    prefs.saveDetailPane({ rightPane: pane, detailCollapsed: collapsed });
  };
  return { root, sidebar, centre, details, chat, togglePane };
}
