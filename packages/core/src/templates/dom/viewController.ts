// Opens and closes the template detail page in place of the grid and keeps the gallery state in step with it.
import type { GalleryTransport, TemplateAddress } from "../protocol/index.js";
import type { TemplateEntry } from "../templateEntry.js";
import type { CardGrid } from "./cardGrid.js";
import { deriveTemplateAddress, type GalleryState } from "./galleryState.js";
import { renderTemplatePage, type TemplatePage } from "./templateView.js";

export interface TemplatePageController {
  /** The page being shown, or `null` while the grid is. */
  current(): TemplatePage | null;
  open(entry: TemplateEntry): void;
  /** Returns to the grid and focuses the card that was open; does nothing when no page is open. */
  closeAndFocus(): void;
  /** Returns to the grid and reports which template was open. */
  close(): TemplateAddress | undefined;
}

export interface TemplatePageControllerParts {
  state: GalleryState;
  main: HTMLElement;
  grid: CardGrid;
  transport: GalleryTransport;
  showGrid(): void;
  requestThumbnails(templates: TemplateAddress[]): void;
}

const keyFor = (entry: TemplateEntry): TemplateAddress => ({ source: entry.source, id: entry.id });

export function createTemplatePageController(parts: TemplatePageControllerParts): TemplatePageController {
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
