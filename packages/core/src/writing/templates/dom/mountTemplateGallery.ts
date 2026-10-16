// Mounts the template gallery into a root element and routes host messages to its views.
import { el, toast } from "../../../ui/dom/index.js";
import type { GalleryTransport, HostToGallery, TemplateKey } from "../protocol/index.js";
import { createCardGrid, type CardGrid } from "./cardGrid.js";
import { createDetailController, type DetailController } from "./detailController.js";
import { createFacetBar } from "./facetBar.js";
import { GalleryState, keyOf } from "./galleryState.js";
import { createSourcesSidebar, type SourcesSidebar } from "./sourcesSidebar.js";

export interface TemplateGalleryHandle {
  /** Stops listening, disconnects the observer and empties the root. */
  dispose(): void;
}

interface RoutedViews {
  state: GalleryState;
  grid: CardGrid;
  sidebar: SourcesSidebar;
  details: DetailController;
}

function routeHostMessage(message: HostToGallery, { state, grid, sidebar, details }: RoutedViews): void {
  const detail = details.current();
  switch (message.type) {
    case "source":
      state.setListing(message.source, message.listing);
      sidebar.update();
      grid.update();
      return;
    case "thumbnail":
      grid.setThumbnail(message.template, message.dataUri);
      if (state.open && state.isOpen(message.template)) detail?.setThumbnail(message.dataUri);
      return;
    case "engine":
      if (!state.isOpen(message.template)) return;
      state.openProblem = message.problem;
      detail?.setProblem(message.problem);
      return;
    case "use.settled":
      state.busy.delete(keyOf(message.template));
      if (state.isOpen(message.template)) detail?.setBusy(false);
      return;
    case "notice":
      toast(message.text, message.kind);
      return;
  }
}

export function mountTemplateGallery(root: HTMLElement, transport: GalleryTransport): TemplateGalleryHandle {
  const state = new GalleryState();
  const main = el("main", {});
  const requestThumbnails = (templates: TemplateKey[]): void => {
    if (templates.length > 0) transport.post({ type: "thumbnails", templates });
  };

  const grid = createCardGrid(state, main, {
    onOpen: (entry) => details.open(entry),
    onThumbnails: requestThumbnails,
  });
  const onFilterChange = (): void => {
    details.close();
    grid.update();
  };
  const facets = createFacetBar(state, onFilterChange);
  const sidebar = createSourcesSidebar(state, {
    onFilterChange,
    onRefresh: () => { grid.update(); transport.post({ type: "refresh" }); },
  });
  const showGrid = (): void => main.replaceChildren(facets.element, grid.element);
  const details = createDetailController({ state, main, grid, transport, showGrid, requestThumbnails });

  showGrid();
  const frame = el("div", { class: "ls-tpl" }, el("div", { class: "ls-tpl-frame" }, sidebar.element, main));
  frame.addEventListener("keydown", (event) => {
    if (event.key === "Escape") details.closeAndFocus();
  });
  root.replaceChildren(frame);
  grid.update();
  const unsubscribe = transport.subscribe((message) => routeHostMessage(message, { state, grid, sidebar, details }));
  transport.post({ type: "ready" });

  return {
    dispose() {
      unsubscribe();
      grid.dispose();
      details.current()?.dispose();
      root.replaceChildren();
    },
  };
}
