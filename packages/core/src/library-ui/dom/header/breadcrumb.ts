/**
 * Titles the list header with its scope and count: "All papers" or a status name at the library root, and inside a
 * folder the path from "Library" down. Every crumb but the current one opens its folder and accepts dropped papers.
 */
import { PAPERS_DIR, ROOT_LABEL, breadcrumbFor } from "../../../library/index.js";
import { STATUS_LABEL } from "../../../model/index.js";
import { el } from "../../../ui/dom/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";
import { makeDropTarget } from "../dnd/index.js";
import type { StatusFilter } from "../../state/index.js";
import type { UiContext } from "../uiContext.js";

// Inside a folder the root crumb names the place, not the scope: "All papers" would claim the list shows every paper.
const LIBRARY_LABEL = "Library";

function crumb(ctx: UiContext, label: string, path: string, isRoot: boolean, last: boolean): HTMLElement {
  const b = el("button", {
    class: `crumb${last ? " current" : ""}`,
    type: "button",
    title: last ? label : `Go to ${label}`,
    html: `${isRoot ? icon("library") : ""}<span>${escapeHtml(label)}</span>`,
  });
  if (!last) {
    b.addEventListener("click", () => ctx.store.openFolder(path));
    makeDropTarget(ctx, b, path);
  }
  return b;
}

export function renderCrumbs(ctx: UiContext, container: HTMLElement, folder: string, status: StatusFilter, count: string): void {
  const chain = breadcrumbFor(PAPERS_DIR, folder, "/");
  const frag = document.createDocumentFragment();
  if (chain.length === 1) {
    frag.append(crumb(ctx, status === "all" ? ROOT_LABEL : STATUS_LABEL[status], PAPERS_DIR, true, true));
  } else {
    chain.forEach((node, i) => {
      if (i > 0) frag.append(el("span", { class: "crumb-sep", html: icon("chevron-right") }));
      frag.append(crumb(ctx, node.isRoot ? LIBRARY_LABEL : node.label, node.path, node.isRoot, i === chain.length - 1));
    });
  }
  frag.append(el("span", { class: "ls-count", text: count }));
  container.replaceChildren(frag);
}
