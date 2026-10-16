// Mounts the template gallery into a root element and routes host messages to its views.
import { el, toast } from "../../../ui/dom/index.js";
import type { GalleryTransport, HostToGallery, TemplateKey } from "../protocol/index.js";
import { createCardGrid, type CardGrid } from "./cardGrid.js";
import { createDetailController, type DetailController } from "./detailController.js";
import { createFacetBar } from "./facetBar.js";
import { GalleryState, keyOf } from "./galleryState.js";
import { createPublishController, type PublishController } from "./publish/index.js";
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
  publishing: PublishController;
}

function routeHostMessage(message: HostToGallery, { state, grid, sidebar, details, publishing }: RoutedViews): void {
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
    case "publish.open":
      publishing.open(message.project, message.draft);
      return;
    case "publish.checks":
    case "publish.auth":
    case "publish.submitted":
    case "publish.failed":
      publishing.route(message);
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
    publishing.close();
    grid.update();
  };
  const facets = createFacetBar(state, onFilterChange);
  const sidebar = createSourcesSidebar(state, {
    onFilterChange,
    onRefresh: () => { grid.update(); transport.post({ type: "refresh" }); },
    onPublish: () => transport.post({ type: "publish.start" }),
  });
  const showGrid = (): void => main.replaceChildren(facets.element, grid.element);
  const details = createDetailController({ state, main, grid, transport, showGrid, requestThumbnails });
  const publishing = createPublishController({
    main, transport, showGrid, closeDetail: () => { details.close(); }, updateGrid: grid.update, focusEntry: sidebar.focusPublish,
  });

  showGrid();
  const frame = el("div", { class: "ls-tpl" }, el("div", { class: "ls-tpl-frame" }, sidebar.element, main));
  frame.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    details.closeAndFocus();
    publishing.closeAndFocus();
  });
  root.replaceChildren(frame);
  grid.update();
  const unsubscribe = transport.subscribe((message) => routeHostMessage(message, { state, grid, sidebar, details, publishing }));
  transport.post({ type: "ready" });

  return {
    dispose() {
      unsubscribe();
      grid.dispose();
      details.current()?.dispose();
      publishing.current()?.dispose();
      root.replaceChildren();
    },
  };
}
