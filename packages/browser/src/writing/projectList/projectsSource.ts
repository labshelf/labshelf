// Lists the library's writing projects as sidebar rows, each with its built PDF and reading progress, and opens their PDF.
import {
  PaperSidecarStore, createBrokenProjectItem, buildReadingList, derivePapersByCiteKey, createReadyProjectItem,
  type ILogger, type LibraryFileSystem, type ProjectEntry, type ReadingList, type ReadyEntry, type SidebarProjectItem,
} from "@labshelf/core";
import { createSidecarPort, listCachedPaperRecords, type BrowserProjects } from "../../storage";

const MODULE = "writing.projectList";

/** A sidebar row plus what the browser needs to open it. */
export interface BrowserProjectRow extends SidebarProjectItem {
  /** The id of the project to open; absent on a broken project. */
  projectId?: string;
  /** The built PDF beside the main file, relative to the project folder. */
  pdf?: string;
}

export interface ProjectsSource {
  /** Logs and rethrows a failure to list. */
  rows(): Promise<BrowserProjectRow[]>;
  /** The entry of the project with this id; undefined when none matches or the listing failed (logged). */
  entryOf(projectId: string): Promise<ProjectEntry | undefined>;
  openPdf(projectId: string, pdf: string): void;
}

export interface ProjectsSourceDeps {
  projects: Pick<BrowserProjects, "listBrowserProjects" | "readProjectFile">;
  fileSystem: LibraryFileSystem;
  logger: ILogger;
  /** Shows a PDF's bytes in a browser tab. */
  showPdf(bytes: Uint8Array): Promise<void>;
}

const NO_READING: ReadingList = { entries: [], neverOpened: 0 };

/** The built PDF sits next to the main file with a .pdf extension, as the builders leave it. */
async function builtPdf({ fileSystem }: ProjectsSourceDeps, entry: ReadyEntry): Promise<string | undefined> {
  if (!entry.main) return undefined;
  const pdf = entry.main.replace(/\.[^./]+$/, "") + ".pdf";
  return (await fileSystem.stat(`${entry.folder}/${pdf}`))?.isFile ? pdf : undefined;
}

/** INVARIANT: the browser keeps no backlink index, so only the papers a project lists count, never the ones it merely cites. */
async function readingListOf({ fileSystem, logger }: ProjectsSourceDeps, entry: ReadyEntry): Promise<ReadingList> {
  try {
    const store = new PaperSidecarStore(createSidecarPort(fileSystem), { logger });
    return await buildReadingList({
      project: entry.settings.id,
      backlinks: new Map(),
      listed: entry.settings.papers ?? [],
      papersByKey: derivePapersByCiteKey(await listCachedPaperRecords()),
      isOpened: async (paperId) => (await store.getReadingState(paperId)) !== null,
    });
  } catch (error) {
    await logger.error(MODULE, error, { action: "readingList", project: entry.settings.id });
    return NO_READING;
  }
}

/** The browser runs no checklist or build, so a row carries no open-item count and no last-build line. */
async function readyRow(deps: ProjectsSourceDeps, entry: ReadyEntry): Promise<BrowserProjectRow> {
  const [pdf, reading] = await Promise.all([builtPdf(deps, entry), readingListOf(deps, entry)]);
  return { ...createReadyProjectItem(entry, undefined, undefined, reading), projectId: entry.settings.id, ...(pdf ? { pdf } : {}) };
}

export function createProjectsSource(deps: ProjectsSourceDeps): ProjectsSource {
  const { projects, logger } = deps;
  const report = (action: string, context: Record<string, unknown>) => (error: unknown): void => { void logger.error(MODULE, error, { action, ...context }); };
  return {
    async rows() {
      try {
        const entries = await projects.listBrowserProjects();
        return await Promise.all(entries.map((entry) => (entry.kind === "broken" ? createBrokenProjectItem(entry) : readyRow(deps, entry))));
      } catch (error) {
        await logger.error(MODULE, error, { action: "listProjects" });
        throw error;
      }
    },
    async entryOf(projectId) {
      try {
        return (await projects.listBrowserProjects()).find((entry) => entry.kind === "ready" && entry.settings.id === projectId);
      } catch (error) {
        await logger.error(MODULE, error, { action: "entryOf", project: projectId });
        return undefined;
      }
    },
    openPdf(projectId, pdf) {
      void projects.readProjectFile(projectId, pdf).then((bytes) => deps.showPdf(bytes)).catch(report("openPdf", { project: projectId, pdf }));
    },
  };
}
