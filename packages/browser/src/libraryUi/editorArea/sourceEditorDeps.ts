// What a source tab hands its editor: the project's files, the notes, code and outputs it links to, the papers it cites, and the review mode kept per project.
import {
  PDF_FILE, PaperNotesStore, PaperSidecarStore, createProjectNotesStore, deriveCodeLanguage, derivePapersByCiteKey, formatError, listProjectCiteKeys, listProjectFiles, posixPathOps,
  type ILogger, type LibraryFileSystem, type NoteInsertSource, type ProjectEntry,
} from "@labshelf/core";
import { showToast } from "@labshelf/core/dom";
import type { createDeckWorkspaceFeed } from "@labshelf/core/deckWorkspace";
import type { Consult } from "@labshelf/core/consult";
import type { CodeFileSource, ReviewMode, SourceEditorDeps, SourceFileAccess } from "@labshelf/core/sourceEditor";
import { browserDictionaryStore, createPaperNotesPort, createSidecarPort, createProjectNoteFiles, listCachedPaperRecords } from "../../storage";
import { addProjectUpdateEvent, createLibraryCitationWiring, type LibraryCitationWiring, type SourceFileMode } from "../../writing";
import { bx, createPdfWorker, extensionPdfAssets } from "../../platform";
import { getBrowserCellPorts } from "../../helper";
import { createBrowserOutputSources, createLibraryOutputFiles } from "../../writing/outputSources";
import type { TabContext } from "./tabKinds";

type DeckFeed = ReturnType<typeof createDeckWorkspaceFeed>;

const MODULE = "tabs.source";

type EditorFile = { projectId: string; path: string };

/** The review mode a project's source tabs open in, kept per project so it survives reopening a tab; Editing until the user picks Reviewing. */
export interface ReviewModeState {
  get(): ReviewMode;
  /** Stores the mode; true when it differs from the stored one. */
  set(mode: ReviewMode): boolean;
  /** Runs when the editor reports a mode picked on its side. */
  onMode(mode: ReviewMode): void;
}

export function createReviewModeState(projectId: string, logger: ILogger, changed: () => void): ReviewModeState {
  const key = `labshelf.reviewMode.${projectId}`;
  let current: ReviewMode = "editing";
  // PLATFORM: localStorage throws when the browser blocks storage; the mode then lasts for this tab only.
  try { if (window.localStorage.getItem(key) === "reviewing") current = "reviewing"; } catch (error) { void logger.error(MODULE, error, { action: "readReviewMode", projectId }); }
  const set = (mode: ReviewMode): boolean => {
    if (mode === current) return false;
    current = mode;
    try { window.localStorage.setItem(key, mode); } catch (error) { void logger.error(MODULE, error, { action: "storeReviewMode", projectId }); }
    return true;
  };
  return { get: () => current, set, onMode: (mode) => { if (set(mode)) changed(); } };
}

/** The library path of a project file, the one the project's files read and write and the live files are keyed by. */
export const fullPathOf = (entry: ProjectEntry, path: string): string => posixPathOps.join(entry.folder, path);

/** The project's files; `saved` runs after each write, and a failure of it is logged without failing the save. */
function projectFiles(fs: LibraryFileSystem, logger: ILogger, entry: ProjectEntry, saved: LibraryCitationWiring["reanchor"] | undefined): SourceFileAccess {
  const full = (path: string): string => fullPathOf(entry, path);
  return {
    list: () => listProjectFiles({ fs, paths: posixPathOps }, entry.folder),
    read: (path) => fs.readText(full(path)),
    write: async (path, text) => {
      await fs.writeText(full(path), text);
      await saved?.(path, text).catch((error: unknown) => void logger.error(MODULE, error, { action: "reanchorCitations", path, message: formatError(error) }));
    },
  };
}

/** The code files Insert code lists and the listings link to: a path climbing out of the library folder is unreadable here, so its listing gets no mark; a missing file is undefined. */
export function codeLinkSource(fs: LibraryFileSystem, entry: ProjectEntry): CodeFileSource {
  const inLibrary = (path: string): string => path.split("/").reduce((segments, segment) => {
    if (segment === "..") { if (segments.pop() === undefined) throw new Error("outside the library folder"); } else if (segment !== "" && segment !== ".") segments.push(segment);
    return segments;
  }, entry.folder.split("/").filter((segment) => segment !== "" && segment !== ".")).join("/");
  return {
    list: async () => (await listProjectFiles({ fs, paths: posixPathOps }, entry.folder)).filter((path) => !path.endsWith(".tex") && deriveCodeLanguage(path) !== undefined),
    read: async (path) => { const target = inLibrary(path); return (await fs.exists(target)) ? await fs.readText(target) : undefined; },
  };
}

/** The notes "Insert from note" reads: the project's notes and the notes of the papers its sources cite; a reader that fails logs and answers empty, so one bad note never empties the picker. */
function noteLinkSource(fs: LibraryFileSystem, logger: ILogger, entry: ProjectEntry & { kind: "ready" }): NoteInsertSource {
  const store = createProjectNotesStore(createProjectNoteFiles(fs, async () => entry.folder), logger);
  const paperNotes = createPaperNotesPort(fs);
  const projectId = entry.settings.id;
  const safe = async <T>(action: string, fallback: T, read: () => Promise<T>): Promise<T> => {
    try {
      return await read();
    } catch (error) {
      void logger.error(MODULE, error, { action, projectId, message: formatError(error) });
      return fallback;
    }
  };
  return {
    listProjectNotes: () => safe("listProjectNotes", [], () => store.list(projectId)),
    readProjectNote: (path) => safe("readProjectNote", undefined, async () => (await store.read(projectId, path)) ?? undefined),
    listCitedPaperIds: () => safe("listCitedPaperIds", [], async () => {
      const keys = await listProjectCiteKeys({ fs, paths: posixPathOps }, entry.folder, entry.settings.format);
      const byKey = derivePapersByCiteKey(await listCachedPaperRecords());
      return [...new Set(keys.flatMap((key) => byKey.get(key)?.id ?? []))];
    }),
    readPaperNote: (paperId) => safe("readPaperNote", undefined, async () => (await paperNotes.read(paperId)) ?? undefined),
  };
}

/** The math preview and spelling switches of the editor's footer: turning one off tells the user how to turn it back on. */
function footerSwitches({ logger, prefs }: TabContext): Pick<SourceEditorDeps, "mathPreview" | "proofing"> {
  return {
    mathPreview: {
      enabled: prefs.mathPreview(),
      disable: () => {
        prefs.saveMathPreview(false);
        showToast("Math preview is off. Turn it back on with the Math preview button in the editor's footer.", "info");
      },
    },
    proofing: {
      store: browserDictionaryStore(logger),
      enabled: prefs.spelling(),
      disable: () => {
        prefs.saveSpelling(false);
        showToast("Spelling is off. Turn it back on with the Spelling button in the editor's footer.", "info");
      },
    },
  };
}

/** What the editor reads of the papers its text cites (notes, highlights, PDFs) and how it opens them in the page. */
function paperDeps({ fs, logger, workspace, prefs, selection }: TabContext): Pick<SourceEditorDeps, "papers" | "notes" | "highlightsOf" | "pdfOf" | "openPaper" | "openNotes"> {
  return {
    papers: listCachedPaperRecords,
    notes: new PaperNotesStore(createPaperNotesPort(fs), { logger }),
    // The highlights of a cited paper, from the sidecar the reader writes them to.
    highlightsOf: (paperId) => new PaperSidecarStore(createSidecarPort(fs), { logger }).getAnnotations(paperId),
    // The paper's PDF for the cite popup and the page thumbnail of a page citation; the reader's own file and worker.
    pdfOf: (paper) => ({
      assets: extensionPdfAssets(), createWorker: createPdfWorker,
      // pdf.js transfers the buffer to its worker, so it gets a private copy of exactly the file's bytes.
      readBytes: async () => (await fs.readFile(`${paper.path}/${PDF_FILE}`)).slice().buffer,
    }),
    // Opens the paper's reader as a tab, at the cited page when the tab is not open yet.
    openPaper: (paperId, page) => workspace.openTab("paper", { paperId, ...(page === undefined ? {} : { page: String(page) }) }),
    // Shows the paper in the Details pane on its Notes tab, the pane the library page lists a paper's notes in.
    openNotes: (paperId) => {
      prefs.save({ detailTab: "notes" });
      selection.publish("source-notes", { kind: "paper", ids: [paperId] });
      selection.activate("source-notes");
    },
  };
}

/** The outputs "Insert output" lists: the project's output files and the helper's runs of them. */
function outputLinkDeps({ fs, logger, project }: TabContext, entry: ProjectEntry, projectId: string): NonNullable<SourceEditorDeps["outputLinks"]> {
  const { sharing } = project();
  return {
    files: createLibraryOutputFiles(fs, entry.folder), projectId,
    sources: createBrowserOutputSources({
      area: bx.storage.local, projectId, logger, helper: getBrowserCellPorts(logger).helper,
      userName: async () => sharing.shares.name() || undefined,
    }),
  };
}

/** The comments and review of a writable file. */
function reviewDeps({ workspace, project }: TabContext, { projectId, path }: EditorFile, review: ReviewModeState): Pick<SourceEditorDeps, "comments" | "review"> {
  const { comments, sharing, suggestions } = project();
  return {
    comments: {
      subscribe: comments.commentAnchorsFor(projectId, path).subscribe,
      add: (range, text) => comments.addComment(projectId, path, range, text),
      open: () => workspace.openTab("comments", { projectId }, 1),
    },
    review: { author: () => sharing.shares.name(), mode: review.get(), suggestions: suggestions.suggestionsFor(projectId, path), onMode: review.onMode },
  };
}

/**
 * What the editor of a project file gets; a shared file this tab does not run opens read-only and takes no comments, which would land in comments.qmd and never reach the share.
 * @param consult the tab's consult windows, whose footer the editor shows; none without the page's live files
 */
export function editorDeps(context: TabContext, entry: ProjectEntry, file: EditorFile, mode: SourceFileMode, review: ReviewModeState, feed: DeckFeed | undefined,
  flush: () => Promise<boolean>, collab: SourceEditorDeps["collab"], consult: Consult | undefined,
): SourceEditorDeps {
  const { fs, logger, tab, workspace, project } = context;
  const { projectId, path } = file;
  const readOnly = mode.kind === "unresolved" || mode.kind === "observing";
  const citations = entry.kind === "ready" ? createLibraryCitationWiring({ fs, logger, entry, flush, papers: listCachedPaperRecords }) : undefined;
  const extensions = [...(feed ? [feed.extension] : []), ...(consult ? [consult.footer()] : [])];
  return {
    projectId, path, files: projectFiles(fs, logger, entry, readOnly ? undefined : citations?.reanchor),
    helper: project().helperProject.editorPort(projectId), problems: project().helperProject.problems.subscribe,
    ...(extensions.length > 0 ? { extensions } : {}),
    openTab: workspace.openTab, logger, onDirty: tab.setDirty,
    ...footerSwitches(context), ...paperDeps(context),
    ...(citations ? { scopesOf: citations.scopesOf } : {}),
    ...(!readOnly && citations ? { libraryCitation: citations.libraryCitation } : {}),
    ...(collab ? { collab } : {}),
    ...(!readOnly && entry.kind === "ready" ? { noteLinks: noteLinkSource(fs, logger, entry), codeLinks: codeLinkSource(fs, entry), outputLinks: outputLinkDeps(context, entry, projectId) } : {}),
    ...(readOnly ? { readOnly: true } : reviewDeps(context, file, review)),
    onSaved: () => void addProjectUpdateEvent({ fs, logger }, { id: projectId, folder: entry.folder }),
  };
}
