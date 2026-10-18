// Shows a project's preview tab body until the PDF preview fills it.
import { el } from "@labshelf/core/dom";
import type { TabModule } from "../types";

export const mountTab: TabModule["mountTab"] = (host) => {
  const body = host.appendChild(el("p", { class: "ls-workspace-placeholder" }, "Loading preview…"));
  return { dispose: () => body.remove() };
};
