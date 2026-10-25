// Opens the tabs a page load names and focuses the one that was active.
import type { EditorArea } from "@labshelf/core/dom";
import type { ILogger } from "@labshelf/core";
import type { PagePlan } from "../pagePlan";
import { parseTabId } from "./tabKinds";
import type { HashSync } from "./hashSync";
import { planRestore } from "./tabPlan";
import type { TabOpener } from "./tabOpener";

export function restoreTabs(target: string, area: EditorArea, opener: TabOpener, hash: HashSync, plan: PagePlan, logger: ILogger): void {
  const restored = planRestore(target, hash.stored(), plan);
  hash.silently(() => {
    for (const id of restored.tabs) {
      const parsed = parseTabId(id);
      if (parsed) opener.open(parsed.kind, parsed.params, undefined, true);
      else void logger.log("WARN", "libraryUi.editorArea", "dropped a tab id no kind reads", { id });
    }
    if (area.tabs().length === 0) opener.open(plan.defaultTab);
    const active = area.tabs().some((t) => t.id === restored.active) ? restored.active : plan.defaultTab;
    if (active !== null) area.activate(active);
  });
  if (!restored.folderLink) hash.write();
}
