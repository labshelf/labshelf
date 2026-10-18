// Lists the library's writing projects as sidebar rows, each with its built PDF and reading progress, and opens their editor page and PDF.
import {
  PaperDataStore, brokenProjectItem, buildReadingList, papersByCiteKey, readyProjectItem,
  type ILogger, type LibraryFileSystem, type ReadingList, type ReadyEntry, type SidebarProjectItem,
} from "@labshelf/core";
import { createSidecarPort, listAllRecords } from "../../storage";
import type { BrowserProjects } from "../../storage/projects";

const MODULE = "library-page.projects";

/** A sidebar row plus what the browser needs to open it. */
export interface BrowserProjectRow extends SidebarProjectItem {
  /** The id the editor page opens; absent on a broken project. */
  projectId?: string;
  /** The built PDF beside the main file, relative to the project folder. */
  pdf?: string;
}

export interface ProjectsSource {
  /** Logs and rethrows a failure to list. */
  rows(): Promise<BrowserProjectRow[]>;
  openEditor(projectId: string): void;
  openPdf(projectId: string, pdf: string): void;
}

export interface ProjectsSourceDeps {
  projects: Pick<BrowserProjects, "listBrowserProjects" | "readProjectFile">;
  fileSystem: LibraryFileSystem;
  logger: ILogger;
  /** Shows a PDF's bytes in a browser tab. */
  showPdf(bytes: Uint8Array): Promise<void>;
  /** Opens the editor page on a project's files. */
  openEditor(projectId: string): Promise<void>;
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
    const store = new PaperDataStore(createSidecarPort(fileSystem), { logger });
    return await buildReadingList({
      project: entry.settings.id,
      backlinks: new Map(),
      listed: entry.settings.papers ?? [],
      papersByKey: papersByCiteKey(await listAllRecords()),
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
  return { ...readyProjectItem(entry, undefined, undefined, reading), projectId: entry.settings.id, ...(pdf ? { pdf } : {}) };
}

export function createProjectsSource(deps: ProjectsSourceDeps): ProjectsSource {
  const { projects, logger } = deps;
  const report = (action: string, context: Record<string, unknown>) => (error: unknown): void => { void logger.error(MODULE, error, { action, ...context }); };
  return {
    async rows() {
      try {
        const entries = await projects.listBrowserProjects();
        return await Promise.all(entries.map((entry) => (entry.kind === "broken" ? brokenProjectItem(entry) : readyRow(deps, entry))));
      } catch (error) {
        await logger.error(MODULE, error, { action: "listProjects" });
        throw error;
      }
    },
    openPdf(projectId, pdf) {
      void projects.readProjectFile(projectId, pdf).then((bytes) => deps.showPdf(bytes)).catch(report("openPdf", { project: projectId, pdf }));
    },
    openEditor(projectId) {
      void deps.openEditor(projectId).catch(report("openEditor", { project: projectId }));
    },
  };
}
