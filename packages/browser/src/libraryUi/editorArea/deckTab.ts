// Deck tab: a talk's or poster's deck.html in the deck editor, the presenter, the audience view or the poster preview, over ctx.fs with a serial saver;
// and a LaTeX or Typst talk's or poster's built PDF in the presenter, audience view or poster preview, built through the Helper when it has none.
import { deckTitleOf, detectSourceDeckKind, readSourceDeckNotes, formatDeckSize, formatError, insertShareQr, newestDeckLink, parseDeck, type ILogger, type LibraryFileSystem, type TabParams } from "@labshelf/core";
import { renderElement, showToast, type EditorTabAction, type EditorTabBody } from "@labshelf/core/dom";
import { getBrowserCellPorts } from "../../helper";
import { bx, createStorageCalibrationStore, downloadBytes, openBlobTab } from "../../platform";
import { findProject } from "../../writing";
import { createDeckAssetResolver, downscaleImage, type DeckAssetResolver } from "./deckAssets";
import { exportDeckFromBrowser } from "./deckExport";
import type { TabContext } from "./tabKinds";
import { openDeckAudienceTab } from "./workspace";

const MODULE = "tabs.deck";
const DECK_PATH = /^(talks|posters)\/[^/]+\/deck\.html$/;

type DeckView = "edit" | "presenter" | "audience" | "poster";
const VIEWS: readonly DeckView[] = ["edit", "presenter", "audience", "poster"];

type DeckModule = typeof import("@labshelf/core/deckEditor");

/** True for a project-relative `talks/<name>/deck.html` or `posters/<name>/deck.html`, the folders new decks are written to. */
export function isDeckPath(path: string): boolean {
  return DECK_PATH.test(path);
}

/** True for a project-relative .html path inside the project: a deck the content marks may be anywhere in it. */
const isProjectHtmlPath = (path: string): boolean => /\.html$/i.test(path) && !path.startsWith("/") && !path.split("/").includes("..");

/** True for a project-relative .tex or .typ path inside the project: the source a LaTeX or Typst talk or poster is shown from. */
const isSourceDeckPath = (path: string): boolean => /\.(tex|typ)$/.test(path) && !path.startsWith("/") && !path.split("/").includes("..");

const readView = (view: string | undefined): DeckView => VIEWS.find((known) => known === view) ?? "edit";

const loadMath = () => import("@labshelf/core/math");

/** The deck's files: library paths for ctx.fs and project-relative names for messages. */
interface DeckFiles { deck: string; theme: string; deckName: string; themeName: string }

function deckFiles(folder: string, path: string): DeckFiles {
  const slash = path.lastIndexOf("/");
  const themeName = slash < 0 ? "theme.css" : `${path.slice(0, slash)}/theme.css`;
  const root = folder.replace(/\/+$/, "");
  return { deck: `${root}/${path}`, theme: `${root}/${themeName}`, deckName: path, themeName };
}

/** Writes the editor's changes one at a time, only the files whose text changed; the tab is dirty while a change is unwritten. */
interface DeckSaver { change(next: { html: string; theme: string }): void; flush(): Promise<boolean> }

function createDeckSaver(fs: LibraryFileSystem, files: DeckFiles, initial: { html: string; theme: string }, hooks: { setDirty(dirty: boolean): void; logger: ILogger }): DeckSaver {
  const saved = { ...initial };
  let pending: { html: string; theme: string } | undefined;
  let queue: Promise<boolean> = Promise.resolve(true);

  const write = async (path: string, name: string, text: string): Promise<boolean> => {
    try {
      await fs.writeText(path, text);
      return true;
    } catch (error) {
      void hooks.logger.error(MODULE, error, { action: "saveDeck", path });
      showToast(`Could not save ${name}.`, "error");
      return false;
    }
  };

  // Runs inside the queue only, so two writes never overlap; a failure keeps the change pending for the next run.
  const drain = async (): Promise<boolean> => {
    while (pending) {
      const next = pending;
      pending = undefined;
      const ok = (next.html === saved.html || (await write(files.deck, files.deckName, next.html)))
        && (next.theme === saved.theme || (await write(files.theme, files.themeName, next.theme)));
      if (!ok) {
        pending ??= next;
        return false;
      }
      saved.html = next.html;
      saved.theme = next.theme;
    }
    hooks.setDirty(false);
    return true;
  };

  const run = (): Promise<boolean> => (queue = queue.then(drain));
  return {
    change: (next) => {
      pending = next;
      hooks.setDirty(true);
      void run();
    },
    flush: () => run(),
  };
}

/** What a deck tab holds while open; every part is released on dispose, also when it mounts after the tab closed. */
interface DeckTabState {
  disposed: boolean;
  assets: DeckAssetResolver | undefined;
  current: { html: string; theme: string } | undefined;
  destroy: Array<() => void>;
  /** The edit view's files and the hooks that reach its editor and saver. */
  edit: { files: DeckFiles; currentSlide(): number; replace(html: string): void; flush(): Promise<boolean> } | undefined;
}

function browserAssetPorts() {
  return { downscale: downscaleImage, createObjectURL: (blob: Blob) => URL.createObjectURL(blob), revokeObjectURL: (url: string) => URL.revokeObjectURL(url) };
}


/** Exports the deck as it is in the editor now; the Helper is connected first when it has not been, so it can print. */
async function exportDeck(format: "pdf" | "html", ctx: TabContext, deck: { path: string }, state: DeckTabState): Promise<void> {
  const { current, assets } = state;
  if (!current || !assets) return;
  const helper = getBrowserCellPorts(ctx.logger).helper();
  if (format === "pdf" && helper.status() === undefined) await helper.connect().catch(() => undefined);
  const size = parseDeck(current.html).model?.size;
  await exportDeckFromBrowser(format, {
    ...current,
    name: deck.path.split("/")[1] ?? "deck",
    size: size ? formatDeckSize(size) : "",
    assets,
  }, { helper: () => helper, download: downloadBytes, openTab: openBlobTab, notify: (message) => showToast(message, "info"), loadMath });
}

const SHARE_FIRST = "Share this deck first.";

/** Shares the deck as a link after the editor's changes are saved; copies the link and says so. */
async function shareDeckLink(ctx: TabContext, state: DeckTabState): Promise<void> {
  const { edit } = state;
  if (!edit) return;
  if (!await edit.flush()) { showToast("Could not save the deck, so it was not shared.", "error"); return; }
  const progress = (): void => undefined;
  const result = await ctx.sharing.shareDeck(edit.files.deck, progress);
  if (result.kind === "noRelay") { showToast("Connect Cloudflare to share links; share links live on your Cloudflare relay.", "info"); return; }
  const copied = await ctx.sharing.copyText(result.link);
  showToast(copied ? "Link copied." : `Share link: ${result.link}`, copied ? "ok" : "info");
}

/** Writes assets/share-qr.svg and puts its image block on the current slide, as one save; asks to share first when the deck has no link. */
async function insertDeckQr(ctx: TabContext, state: DeckTabState): Promise<void> {
  const { edit, current } = state;
  if (!edit || !current) return;
  const title = deckTitleOf(current.html, edit.files.deck.split("/").slice(-2, -1)[0] ?? "deck");
  const found = newestDeckLink(await ctx.sharing.sharedLinks(), title);
  if (!found) { showToast(SHARE_FIRST, "info"); return; }
  const result = insertShareQr(current.html, found.link, edit.currentSlide());
  if (!result.ok) { showToast(`Could not insert the QR code: ${result.error}`, "error"); return; }
  const folder = edit.files.deck.slice(0, edit.files.deck.lastIndexOf("/"));
  await ctx.fs.ensureDir(`${folder}/assets`);
  await ctx.fs.writeText(`${folder}/${result.insert.svgPath}`, result.insert.svg);
  edit.replace(result.insert.html);
  if (!await edit.flush()) { showToast("Could not save the deck.", "error"); return; }
  showToast("QR code added.", "ok");
}

function editActions(ctx: TabContext, deck: { projectId: string; path: string }, state: DeckTabState): EditorTabAction[] {
  const run = (format: "pdf" | "html") => (): void => {
    exportDeck(format, ctx, deck, state).catch((error: unknown) => {
      void ctx.logger.error(MODULE, error, { action: `export-${format}`, ...deck });
      showToast(`Could not export the deck: ${formatError(error)}`, "error");
    });
  };
  const failed = (action: string, done: Promise<void>): void => {
    done.catch((error: unknown) => {
      void ctx.logger.error(MODULE, error, { action, ...deck });
      showToast(`Could not ${action === "share" ? "share the deck" : "insert the QR code"}: ${formatError(error)}`, "error");
    });
  };
  return [
    {
      id: "present", icon: "play", label: "Present",
      run: () => {
        ctx.workspace.openTab("deck", { ...deck, view: "presenter" });
        openDeckAudienceTab(deck).catch((error: unknown) => void ctx.logger.error(MODULE, error, { action: "openAudience", ...deck }));
      },
    },
    { id: "posterPreview", icon: "eye", label: "Poster preview", run: () => ctx.workspace.openTab("deck", { ...deck, view: "poster" }) },
    { id: "exportPdf", icon: "download", label: "Export PDF", run: run("pdf") },
    { id: "exportHtml", icon: "download", label: "Export HTML", run: run("html") },
    { id: "shareLink", icon: "link", label: "Share as link", run: () => failed("share", shareDeckLink(ctx, state)) },
    { id: "insertQr", icon: "file-media", label: "Insert QR code", run: () => failed("insertQr", insertDeckQr(ctx, state)) },
  ];
}

/** pdf.js as the extension ships it; its worker is started from the extension's own URL, since MV3 pages may not start blob: workers. */
export function extensionPdfAssets() {
  const at = (path: string): string => bx.runtime.getURL(`vendor/pdfjs/${path}`);
  return { pdfjsUrl: at("build/pdf.min.mjs"), workerUrl: at("build/pdf.worker.min.mjs"), cMapUrl: at("cmaps/"), stdFontUrl: at("standard_fonts/"), wasmUrl: at("wasm/"), iccUrl: at("iccs/") };
}

/** The library path of a source's built PDF (beside it, as the builders leave it), built through the Helper first when it is missing. */
async function builtPdfOf(ctx: TabContext, deck: { projectId: string; path: string }, file: string, say: (text: string) => void): Promise<string> {
  const pdf = file.replace(/\.[^./]+$/, ".pdf");
  if (await ctx.fs.exists(pdf)) return pdf;
  say(`Building ${deck.path}…`);
  const result = await getBrowserCellPorts(ctx.logger).helper().compile({ projectId: deck.projectId, main: deck.path, mode: "full" }, () => undefined);
  if (result.status !== "succeeded" || !(await ctx.fs.exists(pdf))) throw new Error(`${deck.path} could not be built (${result.status}). Build it, then try again.`);
  return pdf;
}

/** Mounts a LaTeX or Typst talk's presenter or audience view, or a poster's preview, on its built PDF. */
async function mountPdfView(host: HTMLElement, ctx: TabContext, deck: { projectId: string; path: string; view: DeckView }, state: DeckTabState, say: (text: string) => void): Promise<void> {
  const { fs, logger } = ctx;
  if (deck.view === "edit") throw new Error(`${deck.path} is edited in the source editor.`);
  const entry = await findProject(fs, logger, ctx.project().session.current(), deck.projectId);
  const file = `${entry.folder.replace(/\/+$/, "")}/${deck.path}`;
  const format = deck.path.endsWith(".typ") ? "typst" : "latex";
  const text = await fs.readText(file);
  if (detectSourceDeckKind(format, text) === null && !/^(talks|posters)\//.test(deck.path)) throw new Error(`${deck.path} is not a talk or poster.`);
  const pdfPath = await builtPdfOf(ctx, deck, file, say);
  const module = await import("@labshelf/core/deckEditor");
  const pdf = await module.openPdfDeck({ assets: extensionPdfAssets(), readBytes: async () => (await fs.readFile(pdfPath)).slice().buffer, createWorker: (url) => new Worker(url, { type: "module" }) });
  if (state.disposed) { pdf.destroy(); return; }
  state.destroy.push(() => pdf.destroy());
  if (deck.view === "poster") {
    const preview = await module.openContentPosterPreview(host, { store: createStorageCalibrationStore(bx.storage.local), content: module.pdfPosterContent(pdf) });
    if (state.disposed) { preview.destroy(); return; }
    state.destroy.push(() => preview.destroy());
    return;
  }
  const notes = readSourceDeckNotes(format, text);
  const channel = module.createBroadcastPresenterChannel(`labshelf-deck:${deck.projectId}:${deck.path}`);
  const presenter = module.openSlidesPresenter(host, { role: deck.view, source: module.pdfSlideSource(pdf, notes, module.mapPagesToSlides(pdf.labels, pdf.count, notes.length)), channel });
  state.destroy.push(() => { presenter.destroy(); channel.close(); });
}

/** Mounts the view's controller in host once the files and the deck chunk have loaded. */
async function mountView(host: HTMLElement, ctx: TabContext, deck: { projectId: string; path: string; view: DeckView }, state: DeckTabState, say: (text: string) => void): Promise<void> {
  const { fs, logger, tab } = ctx;
  if (isSourceDeckPath(deck.path)) return mountPdfView(host, ctx, deck, state, say);
  // The params come from the URL hash too; only an HTML file inside the project may reach ctx.fs.
  if (!isProjectHtmlPath(deck.path)) throw new Error(`Not a deck path: ${deck.path}`);
  const entry = await findProject(fs, logger, ctx.project().session.current(), deck.projectId);
  const files = deckFiles(entry.folder, deck.path);
  const loadingModule: Promise<DeckModule> = import("@labshelf/core/deckEditor");
  const html = await fs.readText(files.deck);
  const theme = (await fs.exists(files.theme)) ? await fs.readText(files.theme) : "";
  const module = await loadingModule;
  if (state.disposed) return;
  const assets = createDeckAssetResolver(fs, files.deck.slice(0, files.deck.lastIndexOf("/")), browserAssetPorts());
  state.assets = assets;
  state.current = { html, theme };
  const common = { html, theme, resolveAsset: assets.resolveAsset, loadMath };

  if (deck.view === "edit") {
    let shown: { setSaved(saved: boolean): void } | undefined;
    const saver = createDeckSaver(fs, files, { html, theme }, { setDirty: (dirty) => { tab.setDirty(dirty); shown?.setSaved(!dirty); }, logger });
    tab.onBeforeClose(() => saver.flush());
    const editor = module.openDeckWorkspace(host, {
      ...common, title: deck.path.split("/").slice(-2, -1)[0] ?? deck.path, history: "internal",
      onChange: ({ html: nextHtml, theme: nextTheme }) => { state.current = { html: nextHtml, theme: nextTheme }; saver.change({ html: nextHtml, theme: nextTheme }); },
    });
    shown = editor;
    state.edit = {
      files,
      currentSlide: () => editor.currentSlide(),
      replace: (nextHtml) => {
        const nextTheme = state.current?.theme ?? theme;
        state.current = { html: nextHtml, theme: nextTheme };
        editor.setDocument(nextHtml, nextTheme);
        saver.change({ html: nextHtml, theme: nextTheme });
      },
      flush: () => saver.flush(),
    };
    state.destroy.push(() => editor.destroy());
    return;
  }
  if (deck.view === "poster") {
    const preview = await module.openPosterPreview(host, { ...common, store: createStorageCalibrationStore(bx.storage.local) });
    if (state.disposed) { preview.destroy(); return; }
    state.destroy.push(() => preview.destroy());
    return;
  }
  const channel = module.createBroadcastPresenterChannel(`labshelf-deck:${deck.projectId}:${deck.path}`);
  const presenter = module.openPresenter(host, { ...common, role: deck.view, channel });
  state.destroy.push(() => { presenter.destroy(); channel.close(); });
}

export function mountTab(el: HTMLElement, params: TabParams, ctx: TabContext): EditorTabBody {
  const deck = { projectId: params["projectId"] ?? "", path: params["path"] ?? "", view: readView(params["view"]) };
  const host = el.appendChild(renderElement("div", { class: "ls-workspace-fill ls-deck-tab" }));
  const loading = host.appendChild(renderElement("p", { class: "ls-workspace-placeholder" }, `Loading ${deck.path}…`));
  const state: DeckTabState = { disposed: false, assets: undefined, current: undefined, destroy: [], edit: undefined };
  mountView(host, ctx, deck, state, (text) => { loading.textContent = text; }).then(() => loading.remove(), (error: unknown) => {
    loading.textContent = `Could not open ${deck.path}: ${formatError(error)}`;
    void ctx.logger.error(MODULE, error, { action: "openDeck", ...deck });
  });
  return {
    dispose: () => {
      state.disposed = true;
      for (const destroy of state.destroy.splice(0)) destroy();
      state.assets?.dispose();
      host.remove();
    },
    ...(deck.view === "edit" ? { actions: editActions(ctx, deck, state) } : {}),
  };
}
