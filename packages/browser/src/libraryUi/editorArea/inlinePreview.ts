// Shows the project's PDF preview beside an article's source in the same tab, the library's sash between them; the eye in the toolbar hides and shows it.
import { attachSplitSash, renderElement, SPLIT_WIDTH_PROPERTY } from "@labshelf/core/dom";
import { readDeckKindOf } from "@labshelf/core/sourceEditor";
import { mountTab as mountPreviewTab } from "./previewTab";
import type { TabContext } from "./tabKinds";

const SHOWN_KEY = "labshelf.inlinePreview.shown";
const WIDTH_KEY = "labshelf.inlinePreview.codeWidth";

export interface InlinePreview {
  shown(): boolean;
  toggle(): void;
  /** Runs `redraw` whenever the preview is shown or hidden; returns the function that stops it. */
  follow(redraw: () => void): () => void;
  dispose(): void;
}

/** A LaTeX or Typst source that is not a talk or poster: the files whose tab carries the project's PDF beside them. */
export function isArticleSource(path: string, text: string): boolean {
  return /\.(tex|typ)$/i.test(path) && readDeckKindOf(path, text) === undefined;
}

const readShown = (): boolean => localStorage.getItem(SHOWN_KEY) !== "false";

/** Splits the source tab `host` into its editor card `body` and the project's preview; the preview mounts on first show. */
export function mountInlinePreview(host: HTMLElement, body: HTMLElement, context: TabContext, projectId: string): InlinePreview {
  const sash = renderElement("div", { class: "ls-split-sash", role: "separator", "aria-orientation": "vertical", "aria-label": "Resize the preview" });
  const pane = renderElement("div", { class: "ls-split-preview" });
  host.classList.add("ls-source-split");
  body.classList.add("ls-split-code");
  const width = localStorage.getItem(WIDTH_KEY);
  if (width) host.style.setProperty(SPLIT_WIDTH_PROPERTY, width);
  host.append(sash, pane);
  // The width is remembered for every article tab.
  attachSplitSash(sash, host, { onEnd: (dragged) => localStorage.setItem(WIDTH_KEY, dragged) });
  const listeners = new Set<() => void>();
  let preview: { dispose(): void } | undefined;
  let visible = readShown();
  const apply = (): void => {
    host.dataset["preview"] = visible ? "shown" : "hidden";
    if (visible && !preview) preview = mountPreviewTab(pane, { projectId }, context);
    for (const redraw of listeners) redraw();
  };
  // Another article tab toggled the preview: every tab follows the one choice.
  const onStorage = (e: StorageEvent): void => { if (e.key === SHOWN_KEY && readShown() !== visible) { visible = readShown(); apply(); } };
  window.addEventListener("storage", onStorage);
  apply();
  return {
    shown: () => visible,
    toggle() {
      visible = !visible;
      localStorage.setItem(SHOWN_KEY, String(visible));
      apply();
    },
    follow(redraw) { listeners.add(redraw); return () => listeners.delete(redraw); },
    dispose() {
      window.removeEventListener("storage", onStorage);
      listeners.clear();
      preview?.dispose();
      sash.remove();
      pane.remove();
      host.classList.remove("ls-source-split");
      body.classList.remove("ls-split-code");
      delete host.dataset["preview"];
    },
  };
}
