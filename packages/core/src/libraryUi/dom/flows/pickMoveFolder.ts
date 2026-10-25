/**
 * Lets the user pick the folder papers move to, then hands the move to the host.
 */
import { PAPERS_DIR, ROOT_LABEL } from "../../../library/index.js";
import { quickPick } from "../../../ui/dom/index.js";
import { listFolderPaths } from "../../viewModel/index.js";
import type { UiContext } from "../uiContext.js";

export async function pickMoveFolder(ctx: UiContext, ids: readonly string[]): Promise<void> {
  const items = [{ label: ROOT_LABEL, path: PAPERS_DIR }, ...listFolderPaths(ctx.store.get().folders)]
    .map((f) => ({ label: f.label, icon: (f.path === PAPERS_DIR ? "library" : "folder") as "library" | "folder", value: f.path }));
  const target = await quickPick(items, { placeholder: `Move ${ids.length === 1 ? "paper" : `${ids.length} papers`} to…` });
  if (target) ctx.transport.post({ type: "paper.move", ids: [...ids], target });
}
