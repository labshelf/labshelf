// Builds the sidebar rows: a papers tree per readable Space and the id of each unreadable one.
import type { SpaceReadResult } from "../model/index.js";
import { buildPapersTree } from "./papersTree.js";
import type { LibraryPapers } from "./resolvePaper.js";
import type { SidebarRow } from "./spaceViewModel.js";

export function deriveSidebarRows(results: readonly SpaceReadResult<unknown>[], library: LibraryPapers): SidebarRow[] {
  return results.map((r) =>
    r.state === "ready"
      ? { id: r.space.id, name: r.space.name, tree: buildPapersTree(r.space, library) }
      : { id: r.id, name: r.id, unreadable: r.reason });
}
