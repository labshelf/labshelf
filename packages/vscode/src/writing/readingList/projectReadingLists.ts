// Builds a project's reading list from the backlink index, the project's papers: entries and the library.
import { buildReadingList, papersByCiteKey, type BacklinkIndex, type ILogger, type PaperRecord, type ReadingList } from "@labshelf/core";
import type { ReadyProject } from "../figures/index.js";

/** The open library as the reading list needs it. */
interface ReadingListSession {
  listPapers(): Promise<PaperRecord[]>;
  /** True when the paper's reader sidecar holds a reading position. */
  isOpened(paperId: string): Promise<boolean>;
  logger: ILogger;
}

interface ReadingListSources {
  backlinks: { index(): BacklinkIndex };
  session: () => ReadingListSession | undefined;
}

export class ProjectReadingLists {
  constructor(private readonly sources: ReadingListSources) {}

  /** The project's reading list; empty when no library is open or its papers cannot be read, after logging why. */
  async of(project: ReadyProject): Promise<ReadingList> {
    const session = this.sources.session();
    if (!session) { return { entries: [], neverOpened: 0 }; }
    try {
      return await buildReadingList({
        project: project.settings.id,
        backlinks: this.sources.backlinks.index(),
        listed: project.settings.papers ?? [],
        papersByKey: papersByCiteKey(await session.listPapers()),
        isOpened: (paperId) => session.isOpened(paperId),
      });
    } catch (error) {
      await session.logger.error("writing/readingList", error, { action: "build", project: project.settings.id });
      return { entries: [], neverOpened: 0 };
    }
  }
}
