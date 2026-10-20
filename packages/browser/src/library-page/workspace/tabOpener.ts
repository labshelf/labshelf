// Opens tabs on the editor area and keeps a tab's dirty mark when it is opened again.
import { type EditorArea, type EditorGroupIndex, type EditorTab } from "@labshelf/core/dom";
import { TAB_KINDS, type TabKindName, type TabParams } from "../tabs";
import type { HashSync } from "./hashSync";
import type { TabBodies } from "./tabBodies";

export interface TabOpener {
  open(kind: TabKindName, params?: TabParams, group?: EditorGroupIndex, background?: boolean): void;
  setDirty(id: string, kind: TabKindName, params: TabParams, dirty: boolean): void;
}

export function createTabOpener(area: () => EditorArea, bodies: () => TabBodies, hash: HashSync): TabOpener {
  const describe = (kind: TabKindName, params: TabParams, group: EditorGroupIndex, dirty?: boolean): EditorTab => {
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
