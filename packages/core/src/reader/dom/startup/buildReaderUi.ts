/**
 * Builds the reader's chrome, sidebar and navigation around an open document and keeps the toolbar in step with them.
 */
import { clampPage } from "../../index.js";
import { BuildBanner, Cheatsheet, SelectionBubble, StatusPill, type ThemeController, openThemePopover, Toolbar } from "../chrome/index.js";
import { FindBar, NavHistory, ZoomController } from "../navigation/index.js";
import type { ReaderContext } from "../session/index.js";
import { AnnotationsTab, OutlineTab, Sidebar, ThumbnailsTab } from "../sidebar/index.js";
import { ReadingStateReporter } from "./readingStateReporter.js";

export interface ReaderUi {
  history: NavHistory;
  zoom: ZoomController;
  goToPage(page: number): void;
  annotationsTab: AnnotationsTab;
  sidebar: Sidebar;
  findBar: FindBar;
  cheatsheet: Cheatsheet;
  pill: StatusPill;
  bubble: SelectionBubble;
  reporter: ReadingStateReporter;
  toolbar: Toolbar;
  buildBanner: BuildBanner;
}

/**
 * @returns every UI piece of the reader, constructed in the order their listeners must register.
 */
export function buildReaderUi(ctx: ReaderContext, theme: ThemeController): ReaderUi {
  const history = new NavHistory(ctx);
  const zoom = new ZoomController(ctx);
  const goToPage = pageJumper(ctx, history);
  const annotationsTab = new AnnotationsTab(ctx.host, goToPage);
  const sidebar = new Sidebar({
    thumbnails: new ThumbnailsTab(ctx, theme, goToPage),
    outline: new OutlineTab(ctx),
    annotations: annotationsTab,
  });
  const findBar = new FindBar(ctx, history);
  const cheatsheet = new Cheatsheet(ctx);
  const pill = new StatusPill(ctx, zoom, goToPage);
  const bubble = new SelectionBubble(ctx);
  const reporter = new ReadingStateReporter(ctx, sidebar);
  const toolbar = new Toolbar(ctx.container, ctx.boot.paperTitle, ctx.boot.isMac, ctx.prefs.toolbarAutoHide, {
    toggleSidebar: () => sidebar.toggle(),
    historyBack: () => history.back(),
    historyForward: () => history.forward(),
    openFind: () => findBar.show(),
    openTheme: (anchor) => openThemePopover(anchor, theme, ctx.host),
    openCheatsheet: () => cheatsheet.toggle(),
  });
  history.onChange(() => toolbar.setHistoryState(history.canGoBack, history.canGoForward));
  sidebar.onChange((s) => toolbar.setSidebarOpen(s.open));
  findBar.onToggle((open) => toolbar.setFindOpen(open));
  const buildBanner = new BuildBanner(ctx.host);
  return { history, zoom, goToPage, annotationsTab, sidebar, findBar, cheatsheet, pill, bubble, reporter, toolbar, buildBanner };
}

/** A jump records the departure first, so Back returns to where the reader was. */
function pageJumper(ctx: ReaderContext, history: NavHistory): (page: number) => void {
  return (page) => {
    const target = clampPage(page, ctx.pdfDocument.numPages);
    if (target === ctx.pdfViewer.currentPageNumber) { return; }
    history.recordDeparture();
    ctx.pdfViewer.currentPageNumber = target;
  };
}
