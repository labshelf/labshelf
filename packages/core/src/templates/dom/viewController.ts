// Opens and closes the template detail page in place of the grid and keeps the gallery state in step with it.
import type { GalleryTransport, TemplateKey } from "../protocol/index.js";
import type { TemplateEntry } from "../templateEntry.js";
import type { CardGrid } from "./cardGrid.js";
import { keyOf, type GalleryState } from "./galleryState.js";
import { renderTemplateDetail, type TemplateDetail } from "./templateView.js";

export interface DetailController {
  /** The page being shown, or `null` while the grid is. */
  current(): TemplateDetail | null;
  open(entry: TemplateEntry): void;
  /** Returns to the grid and focuses the card that was open; does nothing when no page is open. */
  closeAndFocus(): void;
  /** Returns to the grid and reports which template was open. */
  close(): TemplateKey | undefined;
}

export interface DetailControllerParts {
  state: GalleryState;
  main: HTMLElement;
  grid: CardGrid;
  transport: GalleryTransport;
  showGrid(): void;
  requestThumbnails(templates: TemplateKey[]): void;
}

const keyFor = (entry: TemplateEntry): TemplateKey => ({ source: entry.source, id: entry.id });

export function createDetailController(parts: DetailControllerParts): DetailController {
  const { state, main, grid, transport } = parts;
  let detail: TemplateDetail | null = null;

  const close = (): TemplateKey | undefined => {
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
    detail = renderTemplateDetail({
      entry,
      thumbnail: state.thumbnails.get(keyOf(entry)),
      problem: undefined,
      busy: state.busy.has(keyOf(entry)),
      onBack: closeAndFocus,
      onUse: () => { state.busy.add(keyOf(entry)); detail?.setBusy(true); transport.post({ type: "use", template }); },
    });
    main.replaceChildren(detail.element);
    detail.focus();
    transport.post({ type: "detail", template });
    parts.requestThumbnails(state.takeUnrequested([template]));
  };

  return { current: () => detail, open, closeAndFocus, close };
}
