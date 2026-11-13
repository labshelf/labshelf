// Builds the reader UI, the hover previews created after first render, and wires the host messages to them.
import { deriveClampedPage, type WebviewToHost } from "../index.js";
import { renderIcon } from "../../ui/index.js";
import { findElement, renderElement, showToast } from "../../ui/dom/index.js";
import { PagePill, Toolbar } from "./toolbar.js";
import { Cheatsheet, type ThemeController } from "./theme.js";
import { ViewModes, openAppearancePopover } from "./appearance.js";
import { SelectionBubble, setQuoteMenuExtras, type QuoteMenuCitation, type QuoteMenuChoice } from "./selectionBubble.js";
import { PageHighlights } from "./pageHighlights.js";
import { FindBar, type ChangeMarks } from "./findMarks.js";
import { Zoom, type Keyboard, type SourceSync } from "./navigation.js";
import { NavigationHistory } from "./navigationHistory.js";
import { createAreaScroller, countBodyPages, mountPreviewChrome, type PreviewChrome, createPreviewOutlineSource } from "./previewChrome.js";
import { mountPreviewDeck } from "./previewDeck.js";
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
import { EquationTool } from "./equationTool.js";
import { createEquationPopover, type EquationPopover } from "./equationPopover.js";
import { loadCoreMath, renderMathInto } from "../../qmd/dom/index.js";
import { ReadingPositionReporter } from "./startup.js";
import { DestPreview } from "./destPreview.js";
import { HoverPreview } from "./hoverPreview.js";
import type { PreviewCitations } from "./citations.js";
import { CitationResolver, FloatResolver, PageTextCache } from "./textLayer.js";
import { formatError } from "../../errors/index.js";
import { openCiteDialog, type CiteChoiceMemory } from "./citeDialog.js";
import { readerCiteClient } from "./citeClient.js";
import { cellRunInfoOf } from "../../qmd/compute/index.js";
import { createConsult, type Consult, type ConsultSetup, type ManuscriptWindow } from "../../writing/consult/dom/createConsult.js";
import { createReaderCitation } from "../../writing/citations/citeFromReader.js";

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
  equationTool: EquationTool;
  equationPopover: EquationPopover;
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
  /** The consult once the host offered one: Cite… starts on its last used manuscript window. */
  consult: { current: Consult | undefined };
}

/**
 * @returns every UI piece of the reader, constructed in the order their listeners must register.
 */
export function buildReaderUi(ctx: ReaderContext, theme: ThemeController): ReaderUi {
  const history = new NavigationHistory(ctx);
  const zoom = new Zoom(ctx);
  const goToPage = pageJumper(ctx, history);
  const consult: ReaderUi["consult"] = { current: undefined };
  const openCite = createCiteOpener(ctx, consult);
  const annotationsTab = new AnnotationsTab(ctx.host, goToPage, openCite);
  const notesTab = new NotesTab(ctx.host, goToPage, () => ctx.pdfViewer.currentPageNumber, ctx.eventBus, ctx.viewState, ctx.boot.paperId);
  const highlights = new PageHighlights(ctx);
  const noteBoxes = new NoteBoxLayer(ctx);
  const boxTool = new BoxTool(ctx);
  const equationTool = new EquationTool(ctx);
  const equationPopover = createReaderEquationPopover(ctx, equationTool);
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
  noteBoxes.onOpenFull = (id, body) => notesTab.reveal(id, body);
  const bubble = new SelectionBubble(ctx, reviewNote ? (selection) => reviewNote.open(selection) : undefined, () => floatingNotes.expectHighlight(), openCite && (({ page, quote }) => openCite(page, quote)));
  bubble.onPlaceNote = (page, x, y) => floatingNotes.addPoint(page, x, y);
  const reporter = new ReadingPositionReporter(ctx, sidebar);
  const viewModes = new ViewModes(ctx);
  const toolbar = createReaderToolbar(ctx, theme, { sidebar, findBar, cheatsheet, viewModes, boxTool, equationTool, bubble, goToPage, openCite });
  bindReaderToolbar(ctx, { toolbar, sidebar, findBar, boxTool, equationTool, bubble });
  if (ctx.boot.preview) { toolbar.hideBoxTool(); }
  // Shown once the host's init says it can extract equations; never in the preview, which shows a build, not a paper.
  toolbar.setEquationToolAvailable(false);
  const buildBanner = new BuildBanner();
  const ui: ReaderUi = {
    history, zoom, goToPage, annotationsTab, notesTab, floatingNotes, noteBoxes, boxTool, equationTool, equationPopover, highlights, sidebar, findBar, cheatsheet, pill, bubble, reporter, toolbar, viewModes, buildBanner,
    previewChrome: null,
    openLogs: (rootPath) => console.warn(`LabShelf reader: no logs view to open for ${rootPath}`),
    consult,
  };
  if (ctx.boot.preview) { attachPreview(ctx, theme, ui); }
  return ui;
}

/**
 * Builds the reader's consult over the host's setup (its windows float over the page) and shows its Consult button and chips in the toolbar.
 * @returns the consult, which the caller disposes when the page goes away.
 */
export function mountReaderConsult(ctx: ReaderContext, ui: Pick<ReaderUi, "toolbar" | "consult">, setup: ConsultSetup): Consult {
  const consult = createConsult({ ...setup, root: document.body, onError: (error) => console.warn("LabShelf reader: consult failed", error) });
  ui.toolbar.setConsult({ choose: () => consult.choose(), windows: consult.windows });
  ui.consult.current = consult;
  const citeKey = ctx.boot.citeKey;
  // The Cite… menus offer each open manuscript window: the citation goes at the window's cursor, and the paper into the project's bibliography.
  if (!ctx.boot.preview && citeKey) {
    const client = readerCiteClient(ctx.host);
    setQuoteMenuExtras((citation) => consult.manuscripts().map((target) => citeInWindowChoice(target, citeKey, citation, client)));
  }
  return consult;
}

/** Cite in <file>: writes the reader's citation over the window's selection, then asks the host to list the paper in the project's bibliography. */
function citeInWindowChoice(target: ManuscriptWindow, citeKey: string, citation: QuoteMenuCitation, client: ReturnType<typeof readerCiteClient>): QuoteMenuChoice {
  const format = target.ref.path.toLowerCase().endsWith(".typ") ? "typst" : "latex";
  return {
    label: `Cite in ${target.title}`, icon: "book-open",
    run: () => {
      const { view } = target;
      const text = createReaderCitation(format, citeKey, citation, false);
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true, userEvent: "input" });
      target.window.raise();
      void client.request({ kind: "bibliography", projectId: target.ref.projectId }).then((reply) => {
        if (reply.kind === "error") throw new Error(reply.message);
        showToast(`Cited ${citeKey} in ${target.title}`, "ok");
      }).catch((error: unknown) => showToast(`Cited ${citeKey}, but the bibliography was not updated: ${formatError(error)}`, "error"));
    },
  };
}

type ToolbarParts = Pick<ReaderUi, "sidebar" | "findBar" | "cheatsheet" | "viewModes" | "boxTool" | "equationTool" | "bubble" | "goToPage"> & { openCite: ((page?: number, quote?: string) => void) | undefined };

/** @returns the reader's toolbar with each control wired to the piece it drives. */
function createReaderToolbar(ctx: ReaderContext, theme: ThemeController, parts: ToolbarParts): Toolbar {
  const { sidebar, findBar, cheatsheet, viewModes, boxTool, equationTool, bubble, goToPage, openCite } = parts;
  return new Toolbar(ctx.container, ctx.boot.isMac, ctx.prefs.toolbarAutoHide, {
    toggleSidebar: () => sidebar.toggle(),
    previousPage: () => goToPage(ctx.pdfViewer.currentPageNumber - 1),
    nextPage: () => goToPage(ctx.pdfViewer.currentPageNumber + 1),
    toggleDetails: () => ctx.host.post({ command: "toggleDetails" }),
    selectColor: (color) => bubble.setColor(color),
    selectTool: (tool) => { boxTool.setActive(false); equationTool.setActive(false); bubble.setTool(tool); },
    openFind: () => findBar.show(),
    toggleBoxTool: () => boxTool.toggle(),
    toggleEquationTool: () => equationTool.toggle(),
    openAppearance: (anchor) => openAppearancePopover(anchor, { ctx, theme, modes: viewModes }),
    openCheatsheet: () => cheatsheet.toggle(),
    ...(openCite && ctx.boot.citeKey ? { citeInProject: () => openCite(), copyCitation: () => ctx.host.post({ command: "copyCitation" }) } : {}),
  });
}

/**
 * Opens the cite popup for a page and passage, both absent for the whole paper; the popup remembers the last project
 * and file for the reader's life. Undefined in a build preview, which shows no library paper, and for a paper without a cite key.
 */
function createCiteOpener(ctx: ReaderContext, consult: ReaderUi["consult"]): ((page?: number, quote?: string) => void) | undefined {
  const citeKey = ctx.boot.citeKey;
  if (ctx.boot.preview || !citeKey) { return undefined; }
  const client = readerCiteClient(ctx.host);
  const memory: CiteChoiceMemory = {};
  return (page, quote) => {
    // A manuscript open in a consult window is the likely target, so the popup starts on it.
    const open = consult.current?.manuscripts()[0];
    if (open) { memory.projectId = open.ref.projectId; memory.path = open.ref.path; }
    openCiteDialog({ client, citeKey, page, quote, memory, post: (message) => ctx.host.post(message) });
  };
}

/** Keeps page bounds, annotation modes and panel toggles in step with the header. */
function bindReaderToolbar(ctx: ReaderContext, { toolbar, sidebar, findBar, boxTool, equationTool, bubble }: Pick<ReaderUi, "toolbar" | "sidebar" | "findBar" | "boxTool" | "equationTool" | "bubble">): void {
  const syncPage = (): void => toolbar.setPageState(ctx.pdfViewer.currentPageNumber, ctx.pdfDocument.numPages);
  ctx.eventBus.on("pagechanging", syncPage);
  ctx.eventBus.on(DOCUMENT_REPLACED, syncPage);
  syncPage();
  bubble.onColorChange = (color) => toolbar.setAnnotationColor(color);
  bubble.onToolChange = (tool) => toolbar.setSelectionTool(tool);
  sidebar.onChange((s) => toolbar.setSidebarOpen(s.open));
  findBar.onToggle((open) => toolbar.setFindOpen(open));
  boxTool.onChange = (on) => { if (on) { bubble.setTool(null); equationTool.setActive(false); } toolbar.setBoxToolActive(on); };
  equationTool.onChange = (on) => { if (on) { bubble.setTool(null); boxTool.setActive(false); } toolbar.setEquationToolActive(on); };
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
    openAppearance: (anchor) => openAppearancePopover(anchor, { ctx, theme, modes: ui.viewModes }),
  });
  const deck = mountPreviewDeck(ctx, post);
  ui.previewChrome = {
    ...chrome,
    applyRoots(roots) {
      chrome.applyRoots(roots);
      const shown = roots.roots.find((root) => root.path === roots.shown);
      ui.bubble.setSourceLinked(shown?.sourceLinks ?? false);
      deck.setRoot(shown);
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

/** Reports a preview PDF that could not reload, at the top of the reader. */
export class BuildBanner {
  private readonly root = findElement("build-banner");

  /**
   * Reports a PDF the reader could not reload; the open document stays on screen.
   */
  showReloadError(message: string): void {
    this.render("rd-build-failed", renderElement("span", { class: "rd-build-icon", html: renderIcon("warning") }), `Could not reload the PDF: ${message}`);
  }

  clear(): void {
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  private render(kind: string, glyph: HTMLElement, text: string): void {
    this.root.className = kind;
    this.root.replaceChildren(glyph, renderElement("span", {}, text));
    this.root.hidden = false;
  }
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
    const info = cellRunInfoOf(msg);
    ui.notesTab.showCellState(msg.requestId, msg.state, info);
    ui.noteBoxes.showCellState(msg.requestId, msg.state, info);
    ui.floatingNotes.showCellState(msg.requestId, msg.state, info);
  });
  host.on("cellPreview", (msg) => {
    for (const surface of [ui.notesTab, ui.noteBoxes, ui.floatingNotes]) { surface.runs.showPreview(msg.requestId, msg.result); }
  });
  host.on("mathResult", (msg) => {
    for (const surface of [ui.notesTab, ui.noteBoxes, ui.floatingNotes]) { surface.runs.showMathResult(msg.requestId, msg.result); }
  });
  // Replies for any box but the open popover's are dropped by the popover.
  host.on("equationProgress", (msg) => ui.equationPopover.progress(msg.requestId, msg.message, msg.fraction));
  host.on("equationResult", (msg) => ui.equationPopover.result(msg.requestId, msg.outcome));
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

/** Shows the result of each equation box beside it; a replaced document closes it. */
function createReaderEquationPopover(ctx: ReaderContext, equationTool: EquationTool): EquationPopover {
  const { host } = ctx;
  const popover = createEquationPopover({
    container: ctx.container,
    post: ({ type, requestId }) => host.post({ command: type, requestId }),
    renderMath: async (target, latex) => { await renderMathInto(target, latex, true, loadCoreMath); },
    copyText: (text) => { host.post({ command: "copyText", text }); return Promise.resolve(); },
    ...(ctx.saveAiKey ? { saveAiKey: ctx.saveAiKey } : {}),
  });
  equationTool.onBox = (requestId, anchor) => popover.open(requestId, anchor);
  ctx.eventBus.on(DOCUMENT_REPLACED, () => popover.close());
  return popover;
}
