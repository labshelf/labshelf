// Shows the page's library UI (list and detail pane) as the Library tab; closing the tab keeps the view for the next open.
import { renderElement } from "@labshelf/core/dom";
import type { TabModule } from "./tabKind";

export const mountTab: TabModule["mountTab"] = (host, _params, ctx) => {
  const fill = host.appendChild(renderElement("div", { class: "ls-workspace-fill" }, ctx.libraryView));
  return { dispose: () => fill.remove() };
};
