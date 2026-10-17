/**
 * Titles the list header with its scope and, while narrowed, its match count: "Library" at the
 * library root, and inside a folder the path from "Library" down. Every crumb but the current one opens its folder and
 * accepts dropped papers.
 */
import { LIBRARY_LABEL, PAPERS_DIR, breadcrumbFor } from "../../../library/index.js";
import { el } from "../../../ui/dom/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";
import { makeDropTarget } from "../dnd/index.js";
import type { UiContext } from "../uiContext.js";

function crumb(ctx: UiContext, label: string, path: string, last: boolean): HTMLElement {
  const b = el("button", {
    class: `crumb${last ? " current" : ""}`,
    type: "button",
    title: last ? label : `Go to ${label}`,
    html: `<span>${escapeHtml(label)}</span>`,
  });
  if (!last) {
    b.addEventListener("click", () => ctx.store.openFolder(path));
    makeDropTarget(ctx, b, path);
  }
  return b;
}

export function renderCrumbs(ctx: UiContext, container: HTMLElement, folder: string, count: string): void {
  const chain = breadcrumbFor(PAPERS_DIR, folder, "/");
  const frag = document.createDocumentFragment();
  if (chain.length === 1) {
    frag.append(crumb(ctx, LIBRARY_LABEL, PAPERS_DIR, true));
  } else {
    chain.forEach((node, i) => {
      if (i > 0) frag.append(el("span", { class: "crumb-sep", html: icon("chevron-right") }));
      frag.append(crumb(ctx, node.isRoot ? LIBRARY_LABEL : node.label, node.path, i === chain.length - 1));
    });
  }
  frag.append(el("span", { class: "ls-count", text: count }));
  container.replaceChildren(frag);
}
