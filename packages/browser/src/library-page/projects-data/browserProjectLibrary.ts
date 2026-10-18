// Composes the core All projects library over the library folder: lists its projects and opens one in the page's project session.
import {
  blankTemplate, createProjectData, createProjectLibrary, posixPathOps,
  type ILogger, type LibraryFileSystem, type PaperRecord, type PdfjsLoader, type ProjectDataPort, type ProjectEntry, type ProjectLibraryPort,
} from "@labshelf/core";
import type { ProjectSession } from "../session";
import type { Workspace } from "../workspace";

// The bridge root is the library folder itself, so the library root path is empty.
const ROOT = "";

// The browser keeps no registry of project folders outside the library and runs no build, so these stay unwritten.
const DEVICE_DIRS = {
  projectRegistryPath: ".research/browser/project-folders.json",
  buildCacheDir: ".research/browser/builds",
  mergeBasesDir: ".research/browser/merge-bases",
};

export interface BrowserProjectLibraryDeps {
  fs: LibraryFileSystem;
  logger: ILogger;
  workspace: Pick<Workspace, "openTab">;
  session: Pick<ProjectSession, "openProject" | "current">;
  pdfjs: PdfjsLoader;
  listPapers(): Promise<PaperRecord[]>;
  /** Asks the title and format of a blank project; undefined when the user cancels. */
  askBlank(): Promise<{ title: string; format: "latex" | "typst" } | undefined>;
}

export function createBrowserProjectData({ fs, logger }: Pick<BrowserProjectLibraryDeps, "fs" | "logger">): ProjectDataPort {
  return createProjectData({ fs, path: posixPathOps, logger, deviceDirs: DEVICE_DIRS });
}

const none = async (): Promise<undefined> => undefined;

export function createBrowserProjectLibrary(deps: BrowserProjectLibraryDeps): ProjectLibraryPort {
  const { fs, logger, workspace, session } = deps;
  const data = createBrowserProjectData(deps);
  const listeners = new Set<() => void>();
  let entries: ProjectEntry[] = [];
  const reload = async (): Promise<void> => { entries = await data.listProjects(ROOT); listeners.forEach((listener) => listener()); };
  const open = async (entry: ProjectEntry): Promise<void> => { await session.openProject(entry); };
  const library = createProjectLibrary({
    data, fs, paths: posixPathOps, logger,
    session: () => ({ root: ROOT, logger }),
    projects: {
      find: (folder) => entries.find((entry) => entry.folder === folder),
      list: () => entries,
      update: (folder, patch) => data.updateProjectSettings(folder, patch),
      reload,
    },
    // No build runs in the browser yet, so there is no outcome, root build, PDF or log to show.
    outcomes: { last: () => undefined },
    builds: { builtRoots: () => [], problemsOf: () => undefined, stateOf: () => undefined },
    listPapers: deps.listPapers,
    pdfjs: deps.pdfjs,
    locate: { pdf: none, rawLog: none },
    host: {
      openProject: open,
      createProject: async (kind) => {
        if (kind !== "blank") return;
        const asked = await deps.askBlank();
        if (!asked) return;
        const entry = await data.createProjectFromTemplate(ROOT, { title: asked.title, ...blankTemplate(asked.format, asked.title) });
        await reload();
        await open(entry);
      },
      openFile: async (entry, path) => { workspace.openTab("source", { projectId: entry.settings.id, path }, 0); },
      build: async () => undefined,
      preview: async (entry) => open(entry),
      openLog: async () => undefined,
      duplicate: async () => { throw new Error("Duplicate is not available in the browser yet."); },
      runCommand: async () => undefined,
      commands: () => [],
      newKinds: () => ["blank"],
      openLabel: () => "Open",
      isOpen: (entry) => session.current()?.folder === entry.folder,
      onChange: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    },
  });
  void reload().catch((error: unknown) => logger.error("library-page.projects-data", error, { action: "listProjects" }));
  return library;
}
