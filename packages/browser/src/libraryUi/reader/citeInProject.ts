// The browser reader's cite port (plan reader-cite-popup D5): core's answerReaderCite over the library's projects, reading and writing their files through the library file system.
import {
  answerReaderCite, posixPathOps, withListedPaper,
  type CiteReply, type CiteRequest, type ILogger, type LibraryFileSystem, type PaperRecord, type ReaderCiteIo,
} from "@labshelf/core";
import { createProjectNoteFiles, listCachedPaperRecords } from "../../storage";
import { createBrowserProjectContent } from "../../writing";
import { sendProjectFileChange } from "../../writing/fileChanges";
import { listReady } from "./readerProjects";

/**
 * @param listPapers the cached library papers a regenerated labshelf.bib draws from
 * An insert tells the library page's source tab of the file, which reloads it or merges it into its unsaved edits (writing/fileChanges.ts).
 */
export function createBrowserReaderCiteIo(
  fs: LibraryFileSystem, logger: ILogger, listPapers: () => Promise<PaperRecord[]> = listCachedPaperRecords,
): ReaderCiteIo {
  const content = createBrowserProjectContent({ fs, logger });
  const pathOf = (folder: string, path: string): string => posixPathOps.join(folder, path);
  return {
    projects: () => listReady(fs, logger),
    listFiles: (project) => createProjectNoteFiles(fs, async () => project.folder).list(project.settings.id),
    recentFiles: () => [],
    read: (project, path) => fs.readText(pathOf(project.folder, path)),
    async insert(project, path, offset, text) {
      const file = pathOf(project.folder, path);
      const raw = await fs.readText(file);
      await fs.writeText(file, raw.slice(0, offset) + text + raw.slice(offset));
      sendProjectFileChange({ projectId: project.settings.id, path });
    },
    // Puts the paper in the project's papers list and regenerates labshelf.bib from it; writes nothing when the user already listed the paper.
    async addToBibliography(project, paper) {
      const papers = withListedPaper(project.settings.papers ?? [], paper);
      if (!papers) return;
      await content.updateProjectSettings(project.folder, { papers });
      await content.updateProjectBibliography({ ...project, settings: { ...project.settings, papers } }, await listPapers());
    },
    async refreshBibliography(project) {
      await content.updateProjectBibliography(project, await listPapers());
    },
  };
}

/** @returns the reader's cite port over the library's projects; `paper` is the paper the page opened. */
export function createReaderCite(
  fs: LibraryFileSystem, logger: ILogger, paper: PaperRecord, listPapers?: () => Promise<PaperRecord[]>,
): (request: CiteRequest) => Promise<CiteReply> {
  const io = createBrowserReaderCiteIo(fs, logger, listPapers);
  return (request) => answerReaderCite(io, paper, request);
}
