// Builds the reader UI, the hover previews created after first render, and wires the host messages to them.
import { deriveClampedPage, type WebviewToHost } from "../index.js";
import { BuildBanner, PagePill, Toolbar } from "./toolbar.js";
import { Cheatsheet, type ThemeController } from "./theme.js";
import { ViewModes, openAppearancePopover } from "./appearance.js";
import { SelectionBubble } from "./selectionBubble.js";
import { PageHighlights } from "./pageHighlights.js";
import { FindBar, type ChangeMarks } from "./findMarks.js";
import { NavigationHistory, Zoom, type Keyboard, type SourceSync } from "./navigation.js";
import { createAreaScroller, countBodyPages, mountPreviewChrome, type PreviewChrome, createPreviewOutlineSource } from "./previewChrome.js";
import { LogsView } from "./previewProblems.js";
import { CommentAsk } from "./previewFooter.js";
import type { ReaderContext } from "./readerSession.js";
import { DOCUMENT_REPLACED, type PdfReloader } from "./pdfLoader.js";
import { AnnotationsTab, Sidebar } from "./sidebar.js";
import { OutlineTab, ThumbnailsTab } from "./sidebarTabs.js";
import { NotesTab } from "./notesTab.js";
import { FloatingNotes } from "./floatingNotes.js";
import { NoteBoxLayer } from "./noteBoxes.js";
import { BoxTool } from "./boxTool.js";
import { ReadingPositionReporter } from "./startup.js";
import { DestPreview } from "./destPreview.js";
import { HoverPreview } from "./hoverPreview.js";
import type { PreviewCitations } from "./citations.js";
import { CitationResolver, FloatResolver, PageTextCache } from "./textLayer.js";
import { formatError } from "../../errors/index.js";

/**
 * Builds the reader's chrome, sidebar and navigation around an open document and keeps the toolbar in step with them.
 */

export interface ReaderUi {
  history: NavigationHistory;
  zoom: Zoom;
  goToPage(page: number): void;
  annotationsTab: AnnotationsTab;
  notesTab: NotesTab;
  floatingNotes: FloatingNotes;
  noteBoxes: NoteBoxLayer;
  boxTool: BoxTool;
  highlights: PageHighlights;
  sidebar: Sidebar;
  findBar: FindBar;
  cheatsheet: Cheatsheet;
  pill: PagePill;
  bubble: SelectionBubble;
  reporter: ReadingPositionReporter;
  toolbar: Toolbar;
  viewModes: ViewModes;
  buildBanner: BuildBanner;
  /** The preview's header, logs view and page count; null in the paper reader. */
  previewChrome: PreviewChrome | null;
  /** Opens the build logs of a root; the paper reader has none and only records the call. */
  openLogs(rootPath: string): void;
}

/**
 * @returns every UI piece of the reader, constructed in the order their listeners must register.
 */
export function buildReaderUi(ctx: ReaderContext, theme: ThemeController): ReaderUi {
  const history = new NavigationHistory(ctx);
  const zoom = new Zoom(ctx);
  const goToPage = pageJumper(ctx, history);
  const annotationsTab = new AnnotationsTab(ctx.host, goToPage);
  const notesTab = new NotesTab(ctx.host, goToPage, () => ctx.pdfViewer.currentPageNumber, ctx.eventBus);
  const highlights = new PageHighlights(ctx);
  const noteBoxes = new NoteBoxLayer(ctx);
  const boxTool = new BoxTool(ctx);
  boxTool.onCreate = (anchor) => noteBoxes.expectBox(anchor);
  const sidebar = new Sidebar({
    thumbnails: new ThumbnailsTab(ctx, theme, goToPage),
    outline: new OutlineTab(ctx),
    annotations: annotationsTab,
    notes: notesTab,
  });
  notesTab.onReveal = () => sidebar.select("notes");
  const findBar = new FindBar(ctx, history);
  const cheatsheet = new Cheatsheet(ctx);
  const pill = new PagePill(ctx, zoom, goToPage);
  const reviewNote = ctx.boot.preview ? new CommentAsk(ctx) : null;
  const floatingNotes = new FloatingNotes(ctx, (id, body) => notesTab.reveal(id, body));
  noteBoxes.onEdit = (id) => floatingNotes.openNote(id);
  const bubble = new SelectionBubble(ctx, reviewNote ? (selection) => reviewNote.open(selection) : undefined, () => floatingNotes.expectHighlight());
  bubble.onPlaceNote = (page, x, y) => floatingNotes.addPoint(page, x, y);
  const reporter = new ReadingPositionReporter(ctx, sidebar);
  const viewModes = new ViewModes(ctx);
  const toolbar = new Toolbar(ctx.container, ctx.boot.isMac, ctx.prefs.toolbarAutoHide, {
    toggleSidebar: () => sidebar.toggle(),
    previousPage: () => goToPage(ctx.pdfViewer.currentPageNumber - 1),
    nextPage: () => goToPage(ctx.pdfViewer.currentPageNumber + 1),
    toggleDetails: () => ctx.host.post({ command: "toggleDetails" }),
    selectColor: (color) => bubble.setColor(color),
    selectTool: (tool) => { boxTool.setActive(false); bubble.setTool(tool); },
    openFind: () => findBar.show(),
    toggleBoxTool: () => boxTool.toggle(),
    openAppearance: (anchor) => openAppearancePopover(anchor, { ctx, theme, modes: viewModes }),
    openCheatsheet: () => cheatsheet.toggle(),
  });
  bindReaderToolbar(ctx, { toolbar, sidebar, findBar, boxTool, bubble });
  if (ctx.boot.preview) { toolbar.hideBoxTool(); }
  const buildBanner = new BuildBanner();
  const ui: ReaderUi = {
    history, zoom, goToPage, annotationsTab, notesTab, floatingNotes, noteBoxes, boxTool, highlights, sidebar, findBar, cheatsheet, pill, bubble, reporter, toolbar, viewModes, buildBanner,
    previewChrome: null,
    openLogs: (rootPath) => console.warn(`LabShelf reader: no logs view to open for ${rootPath}`),
  };
  if (ctx.boot.preview) { attachPreview(ctx, theme, ui); }
  return ui;
}

/** Keeps page bounds, annotation modes and panel toggles in step with the header. */
function bindReaderToolbar(ctx: ReaderContext, { toolbar, sidebar, findBar, boxTool, bubble }: Pick<ReaderUi, "toolbar" | "sidebar" | "findBar" | "boxTool" | "bubble">): void {
  const syncPage = (): void => toolbar.setPageState(ctx.pdfViewer.currentPageNumber, ctx.pdfDocument.numPages);
  ctx.eventBus.on("pagechanging", syncPage);
  ctx.eventBus.on(DOCUMENT_REPLACED, syncPage);
  syncPage();
  bubble.onColorChange = (color) => toolbar.setAnnotationColor(color);
  bubble.onToolChange = (tool) => toolbar.setSelectionTool(tool);
  sidebar.onChange((s) => toolbar.setSidebarOpen(s.open));
  findBar.onToggle((open) => toolbar.setFindOpen(open));
  boxTool.onChange = (on) => { if (on) { bubble.setTool(null); } toolbar.setBoxToolActive(on); };
}

/** Mounts the preview's logs view and chrome; Comment in the selection bubble follows the shown root's source links. */
function attachPreview(ctx: ReaderContext, theme: ThemeController, ui: ReaderUi): void {
  const post = (msg: WebviewToHost): void => ctx.host.post(msg);
  // The pane covers #viewerContainer's parent, so it neither scrolls with the pages nor hides the sidebar.
  const logs = new LogsView({ parent: ctx.container.parentElement ?? ctx.container, post });
  ui.openLogs = (rootPath) => logs.open(rootPath);
  const chrome = mountPreviewChrome({
    post, logs, outline: createPreviewOutlineSource(ctx),
    countBodyPages: () => countBodyPages(ctx.pdfDocument),
    pdfViewer: ctx.pdfViewer, scrollTo: createAreaScroller(ctx),
    setPagesDark: (dark) => theme.lockPages(dark ? "dark" : "light"),
  });
  ui.previewChrome = {
    ...chrome,
    applyRoots(roots) {
      chrome.applyRoots(roots);
      ui.bubble.setCommentable(roots.roots.find((root) => root.path === roots.shown)?.sourceLinks ?? false);
    },
  };
}

/** A jump records the departure first, so Back returns to where the reader was. */
function pageJumper(ctx: ReaderContext, history: NavigationHistory): (page: number) => void {
  return (page) => {
    const target = deriveClampedPage(page, ctx.pdfDocument.numPages);
    if (target === ctx.pdfViewer.currentPageNumber) { return; }
    history.recordDeparture();
    ctx.pdfViewer.currentPageNumber = target;
  };
}

/**
 * Holds the hover preview, which is built at idle time after the first page renders because reading page one never needs it.
 */

interface DocumentText {
  citations: CitationResolver;
  floats: FloatResolver;
  pageText: PageTextCache;
}

export class DeferredHover {
  private preview: HoverPreview | null = null;

  constructor(
    private readonly ctx: ReaderContext,
    private readonly theme: ThemeController,
    private readonly citations: PreviewCitations,
  ) {
    ctx.eventBus.on(DOCUMENT_REPLACED, () => {
      if (!this.preview) { return; }
      const text = this.readText();
      this.preview.useText(text.citations, text.floats, text.pageText);
    });
  }

  /**
   * Closes the popup if the preview exists yet.
   */
  close(): void {
    this.preview?.close();
  }

  /**
   * Builds the preview once the browser is idle.
   */
  createWhenIdle(): void {
    requestIdleCallback(() => {
      const text = this.readText();
      this.preview = new HoverPreview(this.ctx, text.citations, text.floats, new DestPreview(this.ctx, this.theme), this.citations, text.pageText);
    });
  }

  // The reference list is located and captions are indexed in the background, so the first hover answers at once.
  private readText(): DocumentText {
    const pageText = new PageTextCache(this.ctx);
    const text = { citations: new CitationResolver(pageText), floats: new FloatResolver(pageText), pageText };
    if (this.ctx.prefs.hoverPreviews) { text.citations.warmUp(); text.floats.warmUp(); }
    return text;
  }
}

/**
 * Applies the host's messages to an open reader: commands, page jumps, annotation updates, preference changes, and a
 * preview's reloads, build state, logs, revealed source points and citation answers, and changed regions.
 */

export interface HostMessageParts {
  ctx: ReaderContext;
  ui: ReaderUi;
  keyboard: Keyboard;
  hover: DeferredHover;
  reloader: PdfReloader;
  sourceSync: SourceSync;
  changeMarks: ChangeMarks;
  citations: PreviewCitations;
}

/**
 * Subscribes the open reader to the host messages it acts on.
 */
export function attachReaderHostMessages({ ctx, ui, keyboard, hover, reloader, sourceSync, changeMarks, citations }: HostMessageParts): void {
  const { host } = ctx;
  host.on("command", (msg) => keyboard.dispatch(msg.id, "host"));
  host.on("scrollToPage", (msg) => ui.goToPage(msg.pageNumber));
  host.on("updateAnnotations", (msg) => {
    ui.annotationsTab.setAnnotations(msg.annotations ?? []);
    ui.highlights.show(msg.annotations ?? []);
    ui.notesTab.setAnnotations(msg.annotations ?? []);
    ui.floatingNotes.setAnnotations(msg.annotations ?? []);
  });
  host.on("updateNotes", (msg) => {
    ui.notesTab.show(msg.items);
    ui.floatingNotes.show(msg.items);
    ui.noteBoxes.show(msg.items);
  });
  host.on("cellState", (msg) => {
    ui.notesTab.showCellState(msg.requestId, msg.state);
    ui.noteBoxes.showCellState(msg.requestId, msg.state);
    ui.floatingNotes.showCellState(msg.requestId, msg.state);
  });
  host.on("cellPreview", (msg) => {
    for (const surface of [ui.notesTab, ui.noteBoxes, ui.floatingNotes]) { surface.runs.showPreview(msg.requestId, msg.result); }
  });
  host.on("prefsChanged", (msg) => {
    ctx.prefs = msg.prefs;
    ui.toolbar.setAutoHide(msg.prefs.toolbarAutoHide);
    if (!msg.prefs.hoverPreviews) { hover.close(); }
  });
  host.on("reloadDocument", (msg) => {
    // Marks describe the document they came with; marks sent after this request belong to the reloaded one.
    changeMarks.show([]);
    reloader.reload(msg.pdfUrl).then(() => ui.previewChrome?.documentChanged()).catch((err: unknown) => ui.buildBanner.showReloadError(formatError(err)));
  });
  // The preview chrome shows the build state in the header and footer.
  host.on("buildStatus", (msg) => ui.previewChrome?.applyBuild(msg));
  host.on("previewRoots", (msg) => ui.previewChrome?.applyRoots(msg.roots));
  host.on("showLogs", (msg) => ui.openLogs(msg.root));
  host.on("revealPoint", (msg) => sourceSync.reveal(msg.point));
  host.on("showChanges", (msg) => changeMarks.show(msg.areas));
  host.on("citation", (msg) => citations.lookup.receive(msg.request, msg.entries));
}
