// Resizes the first editor group against the second with the frame's sash and keeps its width in the prefs port.
import { attachSash } from "../shell/index.js";
import { el } from "../../../ui/dom/index.js";
import type { EditorAreaPrefsPort } from "./types.js";

const MIN_GROUP_WIDTH = 160;

export interface EditorSash {
  el: HTMLElement;
  /** Applies the saved width while both groups show; one group fills the area. */
  layout(split: boolean): void;
}

/** Wires the sash between `root`'s groups; `first` is the group it sizes. */
export function createEditorSash(root: HTMLElement, first: HTMLElement, prefs: EditorAreaPrefsPort | undefined): EditorSash {
  const sash = el("div", { class: "ls-editor-sash", role: "separator", "aria-orientation": "vertical", title: "Drag to resize", hidden: true });
  let width = prefs?.load() ?? null;
  const apply = (split: boolean): void => {
    const sized = split && width !== null;
    first.style.width = sized ? `${width}px` : "";
    first.classList.toggle("sized", sized);
  };
  // Until the first drag both groups share the width equally; the drag starts from the width they have.
  sash.addEventListener("pointerdown", () => {
    if (width !== null) return;
    width = Math.round(first.getBoundingClientRect().width) || MIN_GROUP_WIDTH;
    apply(true);
  });
  attachSash(sash, {
    root, pane: first, collapsedClass: "never-collapsed",
    limits: { min: MIN_GROUP_WIDTH, max: Number.POSITIVE_INFINITY, collapseAt: Number.NEGATIVE_INFINITY },
    widthFromPointer: (x) => {
      const box = root.getBoundingClientRect();
      return Math.min(x - box.left, Math.max(MIN_GROUP_WIDTH, box.width - MIN_GROUP_WIDTH));
    },
    persist: (w) => { width = w; prefs?.save(w); },
  });
  return {
    el: sash,
    layout: (split) => { sash.hidden = !split; apply(split); },
  };
}
