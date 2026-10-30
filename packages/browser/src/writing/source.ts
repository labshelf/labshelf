// Edits a source file from its title bar and tab: insertions and wrapping, symbol, table, image and citation actions, the shared-file modes and read-only notices.
import {
  CITE_WITHOUT_PAGE, IMAGE_EXTENSIONS, IMAGE_FOLDER, MATH_SYMBOLS, MAX_TABLE_SIDE, PaperSidecarStore,
  createCitationSnippet, createImageSnippet, createTableSnippet, deriveChoiceCitationSpec, deriveImageBaseFolder, derivePaperPickText, deriveSymbolSource,
  findFreeImageName, formatError, formatHighlightLabel, formatHighlightPage, listQuotableHighlights, parseTableSize, posixPathOps, readFileText, readShareIndexDocFiles,
  type Annotation, type HighlightChoice, type ILogger, type LibraryFileSystem, type PaperRecord, type ProjectEntry,
} from "@labshelf/core";
import { askInputBox, pickQuickEntry, renderElement, renderIcon, showToast, type EditorTabAction, type IconName, type QuickPickEntry } from "@labshelf/core/dom";
import type { SourceLanguage, SourceUpdates } from "@labshelf/core/sourceEditor";
import type { PageShare } from "../collab";
import type { TabContext } from "../libraryUi/editorArea";
import { createSidecarPort } from "../storage";
import type { SourceEditorDeps } from "./editor";
import type { NoteLinkActions } from "./noteLinks";
import { createBrowserProjectContent } from "./project";

// The text updates and the source language live in core; these keep the browser's import path.
export { createFormattingKeymap, createSourceUpdates, deriveCodeMirrorTemplate, deriveSourceLanguage, type SourceLanguage, type SourceUpdates } from "@labshelf/core/sourceEditor";

/** Every symbol as a pick item, a category heading before its first one. */
export function listSymbolEntries(language: SourceLanguage): QuickPickEntry<string>[] {
  const entries: QuickPickEntry<string>[] = [];
  let category: string | undefined;
  for (const symbol of MATH_SYMBOLS) {
    if (symbol.category !== category) {
      category = symbol.category;
      entries.push({ kind: "separator", label: category });
    }
    const source = deriveSymbolSource(symbol, language);
    entries.push({ label: symbol.glyph, description: source, value: source });
  }
  return entries;
}

export async function addSymbol(edits: SourceUpdates, language: SourceLanguage): Promise<void> {
  const source = await pickQuickEntry(listSymbolEntries(language), { title: "Insert Symbol", placeholder: "Search by name, e.g. alpha or arrow" });
  if (source !== undefined) edits.insertText(source);
}

export async function addTable(edits: SourceUpdates, language: SourceLanguage): Promise<void> {
  const answer = await askInputBox({
    title: "Insert Table",
    prompt: "Columns x rows",
    value: "3x3",
    validate: (value) => (parseTableSize(value) ? null : `Enter columns x rows, each from 1 to ${MAX_TABLE_SIDE}, e.g. 3x2`),
  });
  const size = answer === undefined ? undefined : parseTableSize(answer);
  if (size) edits.insertSnippet(createTableSnippet(language, size));
}

const MODULE = "tabs.source";

export interface AddImageDeps {
  edits: SourceUpdates;
  language: SourceLanguage;
  entry: Extract<ProjectEntry, { kind: "ready" }>;
  /** The edited file, relative to the project folder. */
  path: string;
  fs: LibraryFileSystem;
  logger: ILogger;
}

// PLATFORM: browsers open the file dialog only from the user's click, so the input is clicked before any await.
function pickImage(language: SourceLanguage): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_EXTENSIONS[language].map((extension) => `.${extension}`).join(",");
    input.addEventListener("change", () => resolve(input.files?.[0]));
    input.addEventListener("cancel", () => resolve(undefined));
    input.click();
  });
}

async function copyIntoProject({ edits, language, entry, path, fs, logger }: AddImageDeps, file: File): Promise<void> {
  const { join, dirname, relative } = posixPathOps;
  const target = await findFreeImageName(posixPathOps, join(entry.folder, IMAGE_FOLDER), file.name, (candidate) => fs.exists(candidate));
  await fs.ensureDir(dirname(target));
  await fs.writeFile(target, new Uint8Array(await file.arrayBuffer()));
  void logger.log("INFO", MODULE, "copied an image into the project", { source: path, image: target });
  const base = deriveImageBaseFolder(language, entry.folder, entry.main, join(entry.folder, path), posixPathOps);
  edits.insertSnippet(createImageSnippet(language, relative(base, target)));
}

export async function addImage(insertion: AddImageDeps): Promise<void> {
  const file = await pickImage(insertion.language);
  if (!file) return;
  try {
    await copyIntoProject(insertion, file);
  } catch (error) {
    void insertion.logger.error(MODULE, error, { source: insertion.path, folder: insertion.entry.folder, action: "insertImage" });
    showToast(`Could not copy the image into the project: ${formatError(error)}`, "error");
  }
}


async function pickPaper(papers: () => Promise<PaperRecord[]>): Promise<PaperRecord | undefined> {
  const all = await papers();
  if (all.length === 0) {
    showToast("LabShelf library is empty.", "info");
    return undefined;
  }
  return pickQuickEntry(all.map((paper) => {
    const { label, description, detail } = derivePaperPickText(paper);
    return { label, description: `${description} · ${detail}`, value: paper };
  }), { title: "Cite from Library", placeholder: "Pick the paper to cite" });
}

/** One entry per highlight under the heading of how it is cited. */
function highlightEntries(heading: string, highlights: readonly Annotation[], quote: boolean): QuickPickEntry<HighlightChoice>[] {
  return [
    { kind: "separator", label: heading },
    ...highlights.map((highlight) => ({
      label: formatHighlightLabel(highlight), description: formatHighlightPage(highlight), value: { highlight, quote },
      ...(quote ? { icon: "quote" as const } : {}),
    })),
  ];
}

/** A paper whose highlights cannot be read is still cited, without a page. */
async function readHighlights(fs: LibraryFileSystem, logger: ILogger, paper: PaperRecord): Promise<Annotation[]> {
  try {
    return listQuotableHighlights(await new PaperSidecarStore(createSidecarPort(fs), { logger }).getAnnotations(paper.id));
  } catch (error) {
    void logger.log("WARN", MODULE, "Highlights of a paper could not be read; citing without a page", { paperId: paper.id, error: String(error) });
    return [];
  }
}

/** Undefined when the picker is dismissed. */
async function pickHighlight(fs: LibraryFileSystem, logger: ILogger, paper: PaperRecord): Promise<HighlightChoice | undefined> {
  const highlights = await readHighlights(fs, logger, paper);
  if (highlights.length === 0) return { quote: false };
  return pickQuickEntry<HighlightChoice>([
    { label: CITE_WITHOUT_PAGE, value: { quote: false } },
    ...highlightEntries("Cite with page", highlights, false),
    ...highlightEntries("Cite with quotation", highlights, true),
  ], { title: "Cite from Library", placeholder: "Pick a highlight to cite its page" });
}


export interface CitationInsertion {
  edits: SourceUpdates;
  /** Saves the file, so the bibliography update sees the new key; resolves whether the file is saved. */
  flush(): Promise<boolean>;
  entry: Extract<ProjectEntry, { kind: "ready" }>;
  fs: LibraryFileSystem;
  logger: ILogger;
  papers(): Promise<PaperRecord[]>;
}

// The paper's BibTeX entry reaches labshelf.bib here; the share merges it when the project is shared.
async function updateBibliography({ flush, entry, fs, logger, papers }: CitationInsertion): Promise<void> {
  try {
    if (!await flush()) throw new Error("The file could not be saved");
    const update = await createBrowserProjectContent({ fs, logger }).updateProjectBibliography(entry, await papers());
    void logger.log("INFO", MODULE, "bibliography updated after a citation", { projectId: entry.settings.id, ...update });
  } catch (error) {
    void logger.error(MODULE, error, { action: "updateBibliography", projectId: entry.settings.id });
    showToast("Could not update labshelf.bib.", "error");
  }
}

export async function addCitationFromLibrary(insertion: CitationInsertion): Promise<void> {
  const { edits, entry, fs, logger, papers } = insertion;
  const paper = await pickPaper(papers);
  if (!paper) return;
  const choice = await pickHighlight(fs, logger, paper);
  if (!choice) return;
  edits.insertText(createCitationSnippet(entry.settings.format, paper.citeKey, deriveChoiceCitationSpec(choice)));
  await updateBibliography(insertion);
}

/** What the actions edit once the editor and its project have loaded. */
interface ActionTarget {
  edits: SourceUpdates;
  /** Saves the file; resolves whether it is saved afterwards. */
  flush(): Promise<boolean>;
  entry: ProjectEntry;
  /** The note-link commands of the editor; undefined when it has no notes to read. */
  noteLinks?: NoteLinkActions | undefined;
}

export interface SourceActionDeps {
  projectId: string;
  path: string;
  language: SourceLanguage;
  fs: LibraryFileSystem;
  logger: ILogger;
  /** Undefined until the editor and project have loaded; an action that needs them then does nothing. */
  target(): ActionTarget | undefined;
  openHistory(): void;
  openSearch(): void;
  papers(): Promise<PaperRecord[]>;
}

export function createSourceActions({ path, language, fs, logger, target, openHistory, openSearch, papers }: SourceActionDeps): EditorTabAction[] {
  const withEdits = (act: (edits: SourceUpdates) => void): (() => void) => () => {
    const current = target();
    if (current) act(current.edits);
  };
  const withNoteLinks = (act: (links: NoteLinkActions) => Promise<void>): (() => void) => () => {
    const links = target()?.noteLinks;
    if (links) void act(links);
  };
  return [
    { id: "history", icon: "history", label: "Show Project History", run: openHistory },
    { id: "insertSymbol", icon: "symbol-operator", label: "Insert Symbol", run: withEdits((edits) => void addSymbol(edits, language)) },
    { id: "insertTable", icon: "table", label: "Insert Table", run: withEdits((edits) => void addTable(edits, language)) },
    { id: "insertImage", icon: "file-media", label: "Insert Image", run: () => {
      const current = target();
      if (current?.entry.kind === "ready") void addImage({ edits: current.edits, language, entry: current.entry, path, fs, logger });
    } },
    { id: "searchInProject", icon: "search", label: "Search in Project", run: openSearch },
    { id: "citeFromLibrary", icon: "quote", label: "Cite from Library", run: () => {
      const current = target();
      if (current?.entry.kind === "ready") void addCitationFromLibrary({ edits: current.edits, flush: current.flush, entry: current.entry, fs, logger, papers });
    } },
    { id: "bold", icon: "bold", label: "Bold", overflow: true, run: withEdits((edits) => edits.wrap("bold")) },
    { id: "italic", icon: "italic", label: "Italic", overflow: true, run: withEdits((edits) => edits.wrap("italic")) },
    ...(language === "latex" ? [{ id: "insertFromNote", icon: "symbol-operator", label: "Insert from note", overflow: true, run: withNoteLinks((links) => links.insert()) } satisfies EditorTabAction] : []),
    { id: "updateFromNote", icon: "refresh", label: "Update from note", overflow: true, run: withNoteLinks((links) => links.update()) },
    { id: "showNoteDifferences", icon: "replace", label: "Show differences", overflow: true, run: withNoteLinks((links) => links.showDifferences()) },
  ];
}

function readOnlyNotice(iconName: IconName, text: string, action: { label: string; icon: IconName; run: () => void }): HTMLElement {
  const button = renderElement("button", { type: "button", class: "ls-btn ls-button-soft", html: renderIcon(action.icon) }, action.label);
  button.addEventListener("click", () => { button.disabled = true; action.run(); });
  return renderElement("div", { class: "ls-source-notice", role: "status" },
    renderElement("span", { class: "ls-source-notice-icon", "aria-hidden": "true", html: renderIcon(iconName) }),
    renderElement("span", { class: "ls-source-notice-text" }, text),
    button);
}

export function renderUnresolvedNotice(retry: () => void): HTMLElement {
  return readOnlyNotice("cloud-off", "This shared file is not ready to edit. It stays read-only until sharing is ready.", { label: "Retry", icon: "refresh", run: retry });
}

export function renderObservingNotice(useHere: () => void): HTMLElement {
  return readOnlyNotice("external", "This shared project is open in another tab. This file is read-only here until you use it here or that tab closes.", { label: "Use here", icon: "target", run: useHere });
}


/** `observing` and `unresolved` keep a shared file out of local edits: a write outside the share would never reach the collaborators. */
export type SourceFileMode =
  | { kind: "local" }
  | { kind: "shared"; collab: NonNullable<SourceEditorDeps["collab"]> }
  | { kind: "observing"; shareId: string }
  | { kind: "unresolved" };

/** `retried`: the user asked to try again, which reconnects the share from its stored key. */
export async function readSourceFileMode(sharing: Pick<PageShare, "liveShare" | "shares">, entry: ProjectEntry, path: string, logger: ILogger, retried: boolean): Promise<SourceFileMode> {
  if (entry.kind !== "ready" || entry.settings.shared === undefined) return { kind: "local" };
  const context = { projectId: entry.settings.id, shareId: entry.settings.shared, path, note: "the file opens read-only until the share connects in this tab" };
  try {
    const live = await sharing.liveShare(entry, retried);
    if (live) {
      if (readShareIndexDocFiles(live.session.index).get(path)?.kind !== "text") {
        void logger.log("INFO", MODULE, "Kept a shared file read-only until its index entry arrives", context);
        return { kind: "unresolved" };
      }
      return { kind: "shared", collab: { text: readFileText(live.session.openDoc(path)), presence: live.presence, name: sharing.shares.name() } };
    }
    void logger.log("WARN", MODULE, "A shared file opened while its share is not connected in this tab", context);
  } catch (error) {
    void logger.error(MODULE, error, { action: "connect the share of a source file", ...context });
  }
  // CONTRACT: documents/contracts/collaboration.md#mirror-ownership
  if (sharing.shares.state(entry.settings.shared)?.kind === "observer") return { kind: "observing", shareId: entry.settings.shared };
  return { kind: "unresolved" };
}


interface TabFile { projectId: string; path: string }

export async function openSharedProjectHere(
  { logger, project }: TabContext, { projectId, path }: TabFile, observing: SourceFileMode, reopen: () => Promise<void>,
): Promise<void> {
  if (observing.kind !== "observing") return;
  void logger.log("INFO", MODULE, "taking a shared project over from another tab", { projectId, path, shareId: observing.shareId });
  // The share's state change remounts this tab once the takeover connects.
  await project().sharing.shares.takeOver(observing.shareId).catch((error: unknown) => {
    void logger.error(MODULE, error, { action: "take a shared project over from another tab", projectId, path, shareId: observing.shareId });
    showToast("Could not use the shared project here. Try again, or close the other tab.", "error");
    void reopen();
  });
}

/** A takeover in either direction flips the tab between running the share and observing it, so `remount` runs; returns the function that stops watching. */
export function mountOnTakeover(
  { project }: TabContext, current: () => { loaded: ProjectEntry | undefined; mode: SourceFileMode | undefined; disposed: boolean }, remount: () => void,
): () => void {
  return project().sharing.shares.onChange(() => {
    const { loaded, mode, disposed } = current();
    const shareId = loaded?.kind === "ready" ? loaded.settings.shared : mode?.kind === "observing" ? mode.shareId : undefined;
    if (shareId === undefined || disposed) return;
    const connected = project().sharing.shares.state(shareId)?.kind === "connected";
    if (connected !== (mode?.kind === "shared")) remount();
  });
}
