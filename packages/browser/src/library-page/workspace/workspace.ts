// Runs the library page's tabs over the core editor area: opens them lazily, keeps the URL hash in step and restores them on load.
import type { ILogger } from "@labshelf/core";
import { el, mountEditorArea, type EditorArea, type EditorAreaPrefsPort, type EditorGroupIndex, type EditorTabBody, type EditorTabInfo } from "@labshelf/core/dom";
import type { PagePlan } from "../sections";
import { TAB_KINDS, parseTabId, type TabContext, type TabKindName, type TabParams } from "../tabs";
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
  services: () => Omit<TabContext, "workspace">;
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

  const mountBody = (kind: TabKindName, params: TabParams, host: HTMLElement): EditorTabBody => {
    let disposed = false;
    let body: EditorTabBody | null = null;
    TAB_KINDS[kind].load()
      .then((module) => { if (!disposed) body = module.mountTab(host, params, { ...services(), workspace }); })
      .catch((error: unknown) => {
        void logger.error(MODULE, error, { action: "mountTab", kind });
        host.append(el("p", { class: "ls-workspace-placeholder", role: "alert" }, `Could not load the ${TAB_KINDS[kind].title(params)} tab.`));
      });
    return { dispose: () => { disposed = true; body?.dispose(); } };
  };

  function open(kind: TabKindName, params: TabParams = {}, group?: EditorGroupIndex, background = false): void {
    const def = TAB_KINDS[kind];
    area.open({ id: def.id(params), title: def.title(params), icon: def.icon, group: group ?? 0, mount: (host) => mountBody(kind, params, host) }, group, { background });
  }

  area = mountEditorArea(slot, {
    onActivate: writeHash,
    onMove: writeHash,
    prefs,
    // The area removes the tab after this returns, so the hash is written once the tab list has settled.
    onClose: () => { setTimeout(writeHash, 0); },
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
    dispose: () => { window.removeEventListener("hashchange", onHashChange); area.dispose(); },
  };
  return workspace;
}
