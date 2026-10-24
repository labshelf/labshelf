// Renders the breadcrumb of the shown file and the outline section the page sits in, with a menu to jump between sections.
import { icon } from "../../../../ui/index.js";
import { el } from "../../../../ui/dom/index.js";
import { outlineTrail, type OutlineRow } from "../../../index.js";
import { buildMenu, togglePopover } from "../../elements/index.js";
import type { PreviewOutlineSource } from "../mountPreviewChrome.js";
import { pdfName } from "../fileName.js";

export interface LoadedOutline {
  rows: OutlineRow[];
  pages: Array<number | null>;
}

export interface Crumbs {
  element: HTMLElement;
  /** Draws the trail for the shown path; does nothing when neither it nor the trail changed. */
  render(path: string | undefined, loaded: LoadedOutline): void;
}

export function createCrumbs(outline: PreviewOutlineSource): Crumbs {
  const element = el("nav", { class: "rd-preview-crumbs", "aria-label": "Document position" });
  let key = "";

  function openMenu(anchor: HTMLElement, rows: readonly OutlineRow[], trail: readonly OutlineRow[]): void {
    const inTrail = new Set(trail.map((r) => r.id));
    const items = rows
      .filter((r) => r.depth < 2)
      .map((r) => ({ label: r.title, checked: inTrail.has(r.id), run: () => outline.jump(r) }));
    togglePopover(anchor, buildMenu(items), "above");
  }

  return {
    element,
    render(path, loaded) {
      const name = path === undefined ? "" : pdfName(path);
      const trail = outlineTrail(loaded.rows, loaded.pages, outline.currentPage());
      const next = `${name}|${loaded.rows.length > 0}|${trail.map((r) => r.id).join(",")}`;
      if (next === key) { return; }
      key = next;
      const file = el("span", { class: "rd-preview-file", title: path ?? "" }, name);
      if (loaded.rows.length === 0) { return element.replaceChildren(file); }
      const button = el("button", { class: "rd-preview-crumb", type: "button", "aria-haspopup": "menu", "aria-expanded": "false" }, file);
      button.addEventListener("click", () => openMenu(button, loaded.rows, trail));
      const parts = trail.flatMap((r) => [
        el("span", { class: "rd-preview-sep", "aria-hidden": "true", html: icon("chevron-right") }),
        el("span", { class: "rd-preview-crumb-title", title: r.title }, r.title),
      ]);
      element.replaceChildren(button, ...parts);
    },
  };
}
