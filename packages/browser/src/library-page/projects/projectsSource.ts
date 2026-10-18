// Feeds the Writing tab from the library's project store: each project with its built PDF and reading list.
import {
  PaperDataStore, buildReadingList, papersByCiteKey, type ILogger, type LibraryFileSystem, type ProjectEntry, type ReadingListEntry,
} from "@labshelf/core";
import type { WritingTabHost, WritingTabProject } from "@labshelf/core/dom";
import { openReader } from "../../reader/access";
import { createSidecarPort, listAllRecords } from "../../storage";
import type { createBrowserProjects } from "../../storage/projects";

const MODULE = "library-page.writing";

export interface WritingHostDeps {
  projects: ReturnType<typeof createBrowserProjects>;
  fileSystem: LibraryFileSystem;
  logger: ILogger;
  /** Shows a PDF's bytes in a browser tab. */
  showPdf(bytes: Uint8Array): Promise<void>;
  /** Opens the editor page on a project's files. */
  openEditor(projectId: string): Promise<void>;
}

type ReadyEntry = Extract<ProjectEntry, { kind: "ready" }>;

/** The built PDF sits next to the main file with a .pdf extension, as the builders leave it. */
async function builtPdf({ fileSystem }: WritingHostDeps, entry: ReadyEntry): Promise<string | undefined> {
  if (!entry.main) return undefined;
  const pdf = entry.main.replace(/\.[^./]+$/, "") + ".pdf";
  return (await fileSystem.stat(`${entry.folder}/${pdf}`))?.isFile ? pdf : undefined;
}

/** INVARIANT: the browser keeps no backlink index, so only the papers a project lists appear, never the ones it merely cites. */
async function readingListOf({ fileSystem, logger }: WritingHostDeps, entry: ReadyEntry): Promise<ReadingListEntry[]> {
  try {
    const store = new PaperDataStore(createSidecarPort(fileSystem), { logger });
    const { entries } = await buildReadingList({
      project: entry.settings.id,
      backlinks: new Map(),
      listed: entry.settings.papers ?? [],
      papersByKey: papersByCiteKey(await listAllRecords()),
      isOpened: async (paperId) => (await store.getReadingState(paperId)) !== null,
    });
    return entries;
  } catch (error) {
    await logger.error(MODULE, error, { action: "readingList", project: entry.settings.id });
    return [];
  }
}

async function tabProject(deps: WritingHostDeps, entry: ProjectEntry): Promise<WritingTabProject> {
  if (entry.kind === "broken") return entry;
  const [pdf, readingList] = await Promise.all([builtPdf(deps, entry), readingListOf(deps, entry)]);
  const { id, title, format } = entry.settings;
  return { kind: "ready", id, name: title ?? id, format, location: entry.location, pdf, readingList };
}

export function createWritingHost(deps: WritingHostDeps): WritingTabHost {
  const { projects, logger } = deps;
  const report = (action: string, context: Record<string, unknown>) => (error: unknown): void => { void logger.error(MODULE, error, { action, ...context }); };
  return {
    async listProjects() {
      try {
        return await Promise.all((await projects.listBrowserProjects()).map((entry) => tabProject(deps, entry)));
      } catch (error) {
        await logger.error(MODULE, error, { action: "listProjects" });
        throw error;
      }
    },
    openPdf(projectId, pdf) {
      void projects.readProjectFile(projectId, pdf).then((bytes) => deps.showPdf(bytes)).catch(report("openPdf", { project: projectId, pdf }));
    },
    openPaper(paperId) {
      void openReader(paperId).catch(report("openPaper", { paperId }));
    },
    editProject(projectId) {
      void deps.openEditor(projectId).catch(report("editProject", { project: projectId }));
    },
  };
}
