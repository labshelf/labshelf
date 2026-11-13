// The browser's side of the consult windows (plan local-sync, spec 9.3): core's answerConsult over the library folder, the opener that binds a
// consulted file to the page's replica hub (so a window and the file's own tab edit one replica), and the consult a source tab mounts.
import {
  PDF_FILE, PaperSidecarStore, answerConsult, deriveCodeLinkPath, bytesToBase64, createPaperFiles, formatError, joinWith, posixPathOps,
  type ConsultIo, type ConsultRef, type ILogger, type LibraryFileSystem,
} from "@labshelf/core";
import { createConsult, editableFromReplica, type Consult, type ConsultOptions, type ConsultSetup, type EditableFile, type EditableFileOpener } from "@labshelf/core/consult";
import { createPaperNotesPort, createSidecarPort, listCachedPaperRecords } from "../storage";
import type { LiveFiles } from "../localSync/liveFiles";
import { createBrowserReaderCiteIo } from "../writing";
import { createPdfWorker, extensionPdfAssets } from "../platform";
import { codeLinkSource } from "../libraryUi/editorArea/sourceEditorDeps";
import { createPickedFiles, type PickedFiles } from "./pickedFile";

const MODULE = "consult";

export interface BrowserConsultDeps { fs: LibraryFileSystem; logger: ILogger; picked: PickedFiles }

const notesPathOfPaper = (paperPath: string): string => createPaperFiles(paperPath, joinWith("/")).notes;

/** Whether a stat answers a file; a failed stat counts as none. */
async function isFile(fs: LibraryFileSystem, path: string): Promise<boolean> {
  try {
    return (await fs.stat(path))?.isFile === true;
  } catch {
    return false;
  }
}

export function createBrowserConsultIo(deps: BrowserConsultDeps): ConsultIo {
  const { fs, logger, picked } = deps;
  // The ready projects and their files, as the reader's cite popup lists them.
  const cite = createBrowserReaderCiteIo(fs, logger, listCachedPaperRecords);
  return {
    listPapers: listCachedPaperRecords,
    paperPdfBase64: async (paper) => bytesToBase64(await fs.readFile(`${paper.path}/${PDF_FILE}`)),
    annotationsOf: (paperId) => new PaperSidecarStore(createSidecarPort(fs), { logger }).getAnnotations(paperId),
    paperNotesText: (paperId) => createPaperNotesPort(fs).read(paperId),
    paperIdsWithNotes: async () => {
      const papers = await listCachedPaperRecords();
      const withNotes = await Promise.all(papers.map((paper) => isFile(fs, notesPathOfPaper(paper.path))));
      return papers.filter((_, index) => withNotes[index]).map((paper) => paper.id);
    },
    projects: cite.projects,
    listFiles: cite.listFiles,
    projectNotes: async (project) => (await cite.listFiles(project)).filter((path) => path.toLowerCase().endsWith(".qmd")),
    listCodeFiles: async () => {
      const lists = await Promise.all((await cite.projects()).map(async (project) =>
        (await codeLinkSource(fs, project).list()).map((path) => posixPathOps.join(project.folder, path))));
      return lists.flat();
    },
    // The window opens in the page; there is nothing more to show.
    open: async () => undefined,
    ...(picked.available ? { browse: () => picked.pick() } : {}),
  };
}

/** The library-relative hub path a ref names; rejects an unknown project or paper. */
async function hubPathOf(ref: Exclude<ConsultRef, { kind: "paper" | "pickedFile" }>, deps: Pick<Parameters<typeof createBrowserFileOpener>[0], "folderOf" | "notesPathOf">): Promise<string> {
  switch (ref.kind) {
    case "manuscript":
    case "projectNote": {
      const folder = await deps.folderOf(ref.projectId);
      if (folder === undefined) throw new Error(`Project ${ref.projectId} not found`);
      return posixPathOps.join(folder, ref.path);
    }
    case "paperNotes": {
      const path = await deps.notesPathOf(ref.paperId);
      if (path === undefined) throw new Error(`Paper ${ref.paperId} not found`);
      return path;
    }
    case "code":
      return ref.path;
  }
}

export function createBrowserFileOpener(deps: { live: LiveFiles; picked: PickedFiles; folderOf(projectId: string): Promise<string | undefined>; notesPathOf(paperId: string): Promise<string | undefined> }): EditableFileOpener {
  return async (ref) => {
    if (ref.kind === "pickedFile") return deps.picked.open(ref.id);
    if (ref.kind === "paper") throw new Error("A paper opens read-only in its paper view");
    const path = await hubPathOf(ref, deps);
    const file = deps.live.open(path);
    try {
      await file.replica.ready;
    } catch (error) {
      await file.release();
      throw error;
    }
    const editable = editableFromReplica(file.replica, path, () => file.flush());
    let released = false;
    // INVARIANT: the LiveFile holds the replica, so it is given back through the LiveFile once, after its pending edits are written.
    const release = (): void => {
      if (released) return;
      released = true;
      void file.flush().catch(() => undefined).then(() => file.release());
    };
    return { ...editable, release } as EditableFile;
  };
}

let pagePicked: PickedFiles | undefined;

/** The files Browse… picked, kept for the page's life. */
const readPagePickedFiles = (): PickedFiles => (pagePicked ??= createPickedFiles());

/**
 * The path a listing records for a consulted library code file (library-relative), relative to the project folder `folder`; a file Browse… picked
 * outside the library has none, so it cannot be listed.
 */
export function deriveConsultCodePath(folder: string, ref: ConsultRef): string | undefined {
  return ref.kind === "code" ? deriveCodeLinkPath(posixPathOps, folder, ref.path) : undefined;
}

/** What a consult needs over the page's live files: the client, the file opener and the PDF source; `projectId` is the source tab's project, none in the reader. */
export function createBrowserConsultSetup(deps: { fs: LibraryFileSystem; logger: ILogger; live: LiveFiles; projectId?: string }): ConsultSetup {
  const { fs, logger, live, projectId } = deps;
  const picked = readPagePickedFiles();
  const io = createBrowserConsultIo({ fs, logger, picked });
  const openFile = createBrowserFileOpener({
    live, picked,
    folderOf: async (id) => (await io.projects()).find((project) => project.settings.id === id)?.folder,
    notesPathOf: async (paperId) => {
      const paper = (await listCachedPaperRecords()).find((record) => record.id === paperId);
      return paper === undefined ? undefined : notesPathOfPaper(paper.path);
    },
  });
  return {
    client: (request) => answerConsult(io, projectId === undefined ? {} : { projectId }, request),
    openFile,
    // pdf.js transfers the buffer to its worker, so each read gets its own copy.
    pdfSource: (bytes) => ({ assets: extensionPdfAssets(), createWorker: createPdfWorker, readBytes: async () => bytes.slice(0) }),
  };
}

/** The consult a source tab of `projectId` mounts over the page's live files; `actions` are its editor's, once mounted. */
export function createBrowserConsult(deps: { fs: LibraryFileSystem; logger: ILogger; live: LiveFiles; projectId: string; actions?: ConsultOptions["actions"] }): Consult {
  const { logger, projectId } = deps;
  return createConsult({
    ...createBrowserConsultSetup(deps),
    ...(deps.actions ? { actions: deps.actions } : {}),
    onError: (error) => void logger.error(MODULE, error, { action: "consult", projectId, message: formatError(error) }),
  });
}
