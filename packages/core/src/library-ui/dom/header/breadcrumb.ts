/**
 * The folder path in the list header: one crumb per level from the library root, the count badge after it. Every
 * crumb but the current one opens its folder and accepts dropped papers.
 */
import { PAPERS_DIR, breadcrumbFor } from "../../../library/index.js";
import { el } from "../../../ui/dom/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";
import { makeDropTarget } from "../dnd/index.js";
import type { UiContext } from "../uiContext.js";

export function renderCrumbs(ctx: UiContext, container: HTMLElement, folder: string, count: string): void {
  const chain = breadcrumbFor(PAPERS_DIR, folder, "/");
  const frag = document.createDocumentFragment();
  chain.forEach((node, i) => {
    const last = i === chain.length - 1;
    if (i > 0) frag.append(el("span", { class: "crumb-sep", html: icon("chevron-right") }));
    const b = el("button", {
      class: `crumb${last ? " current" : ""}`,
      type: "button",
      title: last ? node.label : `Go to ${node.label}`,
      html: `${node.isRoot ? icon("library") : ""}<span>${escapeHtml(node.label)}</span>`,
    });
    if (!last) {
      b.addEventListener("click", () => ctx.store.openFolder(node.path));
      makeDropTarget(ctx, b, node.path);
    }
    frag.append(b);
  });
  frag.append(el("span", { class: "ls-count", text: count }));
  container.replaceChildren(frag);
}
