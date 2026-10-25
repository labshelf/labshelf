// Mounts the body of each tab lazily and runs the close guards the bodies register.
import type { ILogger } from "@labshelf/core";
import { el, type EditorTabBody } from "@labshelf/core/dom";
import { TAB_KINDS } from "./tabKinds";
import type { TabContext, TabHooks, TabKindName, TabParams } from "./tabKind";
import type { Workspace } from "./workspace";

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
          host.append(el("p", { class: "ls-workspace-placeholder", role: "alert" }, `Could not load the ${TAB_KINDS[kind].title(params)} tab.`));
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
