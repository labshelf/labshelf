/**
 * Builds the reader's chrome, sidebar and navigation around an open document and keeps the toolbar in step with them.
 */
import { clampPage, type WebviewToHost } from "../../index.js";
import { BuildBanner, Cheatsheet, SelectionBubble, StatusPill, type ThemeController, openThemePopover, Toolbar } from "../chrome/index.js";
import { FindBar, NavHistory, visiblePoint, ZoomController } from "../navigation/index.js";
import { countBodyPages, LogsView, mountPreviewChrome, type PreviewChrome } from "../preview/index.js";
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
  /** The preview's toolbar actions, notice and logs view; null in the paper reader. */
  previewChrome: PreviewChrome | null;
  /** Opens the build logs of a root; the paper reader has none and only records the call. */
  openLogs(rootPath: string): void;
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
  const buildBanner = new BuildBanner();
  const ui: ReaderUi = {
    history, zoom, goToPage, annotationsTab, sidebar, findBar, cheatsheet, pill, bubble, reporter, toolbar, buildBanner,
    previewChrome: null,
    openLogs: (rootPath) => console.warn(`LabShelf reader: no logs view to open for ${rootPath}`),
  };
  if (ctx.boot.preview) {
    const post = (msg: WebviewToHost): void => ctx.host.post(msg);
    // The pane covers #viewerContainer's parent, so it neither scrolls with the pages nor hides the sidebar.
    const logs = new LogsView({ parent: ctx.container.parentElement ?? ctx.container, post });
    ui.openLogs = (rootPath) => logs.open(rootPath);
    ui.previewChrome = mountPreviewChrome({
      actions: toolbar.actions, banner: buildBanner, post, logs, visiblePoint: () => visiblePoint(ctx),
      countBodyPages: () => countBodyPages(ctx.pdfDocument),
    });
  }
  return ui;
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
