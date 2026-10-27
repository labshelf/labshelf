// Mounts the template gallery over its host transport and opens and closes the template detail page in place of the grid.
import { renderElement, showToast } from "../../ui/dom/index.js";
import type { GalleryTransport, HostToGallery, TemplateAddress } from "../host/index.js";
import type { TemplateEntry } from "../templateCatalog.js";
import { createFacetBar, createGalleryHeader, deriveTemplateAddress, GalleryState, type GalleryHeader } from "./galleryControls.js";
import { createPublishController, type PublishController } from "./publishController.js";
import { createCardGrid, renderTemplatePage, type CardGrid, type TemplatePage } from "./templateCards.js";

export interface TemplateGalleryView {
  dispose(): void;
}

interface RoutedViews {
  state: GalleryState;
  grid: CardGrid;
  header: GalleryHeader;
  details: TemplatePageController;
  publishing: PublishController;
}

function routeHostMessage(message: HostToGallery, { state, grid, header, details, publishing }: RoutedViews): void {
  const detail = details.current();
  switch (message.type) {
    case "source":
      state.setListing(message.source, message.listing);
      header.update();
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
      state.busy.delete(deriveTemplateAddress(message.template));
      if (state.isOpen(message.template)) detail?.setBusy(false);
      return;
    case "notice":
      showToast(message.text, message.kind);
      return;
    case "publish.open":
      publishing.open(message.project, message.draft);
      return;
    case "publish.failed":
      if (publishing.current()) publishing.route(message);
      else showToast(message.error, "error");
      return;
    case "publish.checks":
    case "publish.auth":
    case "publish.submitted":
      publishing.route(message);
      return;
  }
}

export function mountTemplateGallery(root: HTMLElement, transport: GalleryTransport): TemplateGalleryView {
  const state = new GalleryState();
  const main = renderElement("main", {});
  const scrollRoot = renderElement("div", { class: "ls-tpl-frame" });
  const requestThumbnails = (templates: TemplateAddress[]): void => {
    if (templates.length > 0) transport.post({ type: "thumbnails", templates });
  };

  const grid = createCardGrid(state, scrollRoot, {
    onOpen: (entry) => details.open(entry),
    onThumbnails: requestThumbnails,
  });
  const onFilterChange = (): void => {
    details.close();
    publishing.close();
    grid.update();
  };
  const facets = createFacetBar(state, onFilterChange);
  const header = createGalleryHeader(state, {
    onFilterChange,
    onRefresh: () => { grid.update(); transport.post({ type: "refresh" }); },
    onPublish: () => transport.post({ type: "publish.start" }),
  });
  const showGrid = (): void => main.replaceChildren(facets.element, grid.element);
  const details = createTemplatePageController({ state, main, grid, transport, showGrid, requestThumbnails });
  const publishing = createPublishController({
    main, transport, showGrid, closeDetail: () => { details.close(); }, updateGrid: grid.update, focusEntry: header.focusPublish,
  });

  showGrid();
  scrollRoot.append(header.element, main);
  const frame = renderElement("div", { class: "ls-tpl" }, scrollRoot);
  frame.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    details.closeAndFocus();
    publishing.closeAndFocus();
  });
  root.replaceChildren(frame);
  grid.update();
  const unsubscribe = transport.subscribe((message) => routeHostMessage(message, { state, grid, header, details, publishing }));
  transport.post({ type: "ready" });

  return { dispose: () => disposeGallery(root, unsubscribe, { state, grid, header, details, publishing }) };
}

function disposeGallery(root: HTMLElement, unsubscribe: () => void, views: RoutedViews): void {
  unsubscribe();
  views.grid.dispose();
  views.details.current()?.dispose();
  views.publishing.current()?.dispose();
  root.replaceChildren();
}

export interface TemplatePageController {
  /** The page being shown, or `null` while the grid is. */
  current(): TemplatePage | null;
  open(entry: TemplateEntry): void;
  /** Returns to the grid and focuses the card that was open; does nothing when no page is open. */
  closeAndFocus(): void;
  /** Returns to the grid and reports which template was open. */
  close(): TemplateAddress | undefined;
}

export interface TemplatePageControllerDeps {
  state: GalleryState;
  main: HTMLElement;
  grid: CardGrid;
  transport: GalleryTransport;
  showGrid(): void;
  requestThumbnails(templates: TemplateAddress[]): void;
}

const keyFor = (entry: TemplateEntry): TemplateAddress => ({ source: entry.source, id: entry.id });

export function createTemplatePageController(parts: TemplatePageControllerDeps): TemplatePageController {
  const { state, main, grid, transport } = parts;
  let detail: TemplatePage | null = null;

  const close = (): TemplateAddress | undefined => {
    if (detail === null || state.open === null) return undefined;
    const opened = keyFor(state.open);
    detail.dispose();
    detail = null;
    state.open = null;
    state.openProblem = undefined;
    parts.showGrid();
    grid.update();
    return opened;
  };

  const closeAndFocus = (): void => {
    const opened = close();
    if (opened) grid.focusCard(opened);
  };

  const open = (entry: TemplateEntry): void => {
    const template = keyFor(entry);
    state.open = entry;
    state.openProblem = undefined;
    detail = renderTemplatePage({
      entry,
      thumbnail: state.thumbnails.get(deriveTemplateAddress(entry)),
      problem: undefined,
      busy: state.busy.has(deriveTemplateAddress(entry)),
      onBack: closeAndFocus,
      onUse: () => { state.busy.add(deriveTemplateAddress(entry)); detail?.setBusy(true); transport.post({ type: "use", template }); },
    });
    main.replaceChildren(detail.element);
    detail.focus();
    transport.post({ type: "detail", template });
    parts.requestThumbnails(state.takeUnrequested([template]));
  };

  return { current: () => detail, open, closeAndFocus, close };
}
