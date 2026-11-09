// What the reader page's project menus (Send to…, Cite in a project…) share: the library's ready projects, where a menu opens and a menu that resolves with its pick.
import type { ILogger, LibraryFileSystem, ProjectEntry } from "@labshelf/core";
import { showMenu, type MenuEntry } from "@labshelf/core/dom";
import { createBrowserProjectContent } from "../../writing";

export type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

export async function listReady(fs: LibraryFileSystem, logger: ILogger): Promise<ReadyProject[]> {
  const entries = await createBrowserProjectContent({ fs, logger }).listProjects("");
  return entries.filter((entry): entry is ReadyProject => entry.kind === "ready");
}

// INVARIANT: the menu has no pointer to open at once the bubble hides, so it opens where the user last pressed.
export function trackPointer(): () => { x: number; y: number } {
  let at = { x: window.innerWidth / 2, y: window.innerHeight / 3 };
  document.addEventListener("pointerdown", (e) => { at = { x: e.clientX, y: e.clientY }; }, true);
  return () => at;
}

/** Resolves with the picked value, or undefined when the menu closes without a pick (Escape, outside click). */
export function pickFromMenu<T>(at: { x: number; y: number }, entries: (pick: (value: T) => void) => MenuEntry[]): Promise<T | undefined> {
  return new Promise((resolve) => {
    // The menu closes before the item's onSelect runs, so a pick settles first.
    showMenu(at, entries(resolve), { onClose: () => { setTimeout(() => resolve(undefined), 0); } });
  });
}
