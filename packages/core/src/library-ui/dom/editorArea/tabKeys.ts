// Handles the editor area's keys: roving focus inside a tablist, Ctrl/Cmd+W to close, Ctrl+Tab to cycle, and the tab menu key.
export interface TabKeyActions {
  /** The focused tab of the focused group, if any. */
  focusedId(): string | null;
  /** The ids of the focused group, in tab order. */
  focusedOrder(): readonly string[];
  /** The ids of the group that holds `id`, in tab order. */
  orderOf(id: string): readonly string[];
  focus(id: string, moveDomFocus: boolean): void;
  close(id: string): void;
  menu(id: string): void;
}

const step = (order: readonly string[], id: string, by: number): string =>
  order[(order.indexOf(id) + by + order.length) % order.length]!;

function rovingTarget(key: string, order: readonly string[], id: string): string | null {
  if (key === "ArrowRight") return step(order, id, 1);
  if (key === "ArrowLeft") return step(order, id, -1);
  if (key === "Home") return order[0] ?? null;
  if (key === "End") return order[order.length - 1] ?? null;
  return null;
}

/** Listens on `root`; keys from inside a tab body bubble here too. */
export function wireTabKeys(root: HTMLElement, a: TabKeyActions): void {
  root.addEventListener("keydown", (e) => {
    const current = a.focusedId();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "w") {
      if (!current) return;
      e.preventDefault();
      a.close(current);
      return;
    }
    if (e.ctrlKey && e.key === "Tab") {
      if (!current) return;
      e.preventDefault();
      a.focus(step(a.focusedOrder(), current, e.shiftKey ? -1 : 1), false);
      return;
    }
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (!tab) return;
    const id = tab.dataset.tabId!;
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); a.menu(id); return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); a.focus(id, true); return; }
    const target = rovingTarget(e.key, a.orderOf(id), id);
    if (target) { e.preventDefault(); a.focus(target, true); }
  });
}
