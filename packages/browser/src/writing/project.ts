// Adapts the project data to the library page: the All projects library, the new-project prompts, pdf.js and finding a project by id.
import {
  createBlankTemplate, createListeners, createProjectContent, createProjectLibrary, posixPathOps,
  type ILogger, type LibraryFileSystem, type PaperRecord, type PdfjsLoader, type PdfLoadingTask, type ProjectContentPort, type ProjectEntry, type ProjectLibraryPort,
} from "@labshelf/core";
import { askInputBox, pickQuickEntry } from "@labshelf/core/dom";
import { loadPdfjs } from "../capture";
import { listCachedPaperRecords } from "../storage";
import type { Workspace } from "../libraryUi/editorArea";
import type { ProjectSession } from "./session";

export function askProjectTitle(defaultTitle: string): Promise<string | undefined> {
  return askInputBox({
    title: "New project", prompt: "Project title", value: defaultTitle,
    validate: (value) => (value.trim() === "" ? "Enter a title." : undefined),
  }).then((title) => title?.trim());
}

async function askBlankProject(): Promise<{ title: string; format: "latex" | "typst" } | undefined> {
  const title = await askProjectTitle("");
  if (!title) return undefined;
  const format = await pickQuickEntry([{ label: "LaTeX", value: "latex" as const }, { label: "Typst", value: "typst" as const }], { title: "Format of the new project" });
  return format === undefined ? undefined : { title, format };
}

const browserPdfjs: PdfjsLoader = {
  load: async () => (await loadPdfjs()) as unknown as Record<string, unknown>,
  getDocument: async (options) => (await loadPdfjs()).getDocument(options) as unknown as PdfLoadingTask,
};

// The bridge root is the library folder itself, so the library root path is empty.
const ROOT = "";

// The browser has no device-local folder outside the library, so it keeps no registry of project folders and writes none into the
// library; it runs no build, so the other two stay unwritten.
const DEVICE_DIRS = {
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

export function createBrowserProjectContent({ fs, logger }: Pick<BrowserProjectLibraryDeps, "fs" | "logger">): ProjectContentPort {
  return createProjectContent({ fs, path: posixPathOps, logger, deviceDirs: DEVICE_DIRS });
}

const none = async (): Promise<undefined> => undefined;

export function createBrowserProjectLibrary(deps: BrowserProjectLibraryDeps): ProjectLibraryPort {
  const { fs, logger, workspace, session } = deps;
  const data = createBrowserProjectContent(deps);
  const listeners = createListeners();
  let entries: ProjectEntry[] = [];
  const reload = async (): Promise<void> => { entries = await data.listProjects(ROOT); listeners.emit(); };
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
        const entry = await data.createProjectFromTemplate(ROOT, { title: asked.title, ...createBlankTemplate(asked.format, asked.title) });
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
      onChange: (listener) => listeners.add(listener),
    },
  });
  void reload().catch((error: unknown) => logger.error("writing.project", error, { action: "listProjects" }));
  return library;
}

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

const isProject = (entry: ProjectEntry | undefined, projectId: string): entry is ReadyProject =>
  entry?.kind === "ready" && entry.settings.id === projectId;

/** The open project is the usual answer; a tab restored after a reload finds its project in the library folder. */
export async function findProject(fs: LibraryFileSystem, logger: ILogger, open: ProjectEntry | undefined, projectId: string): Promise<ReadyProject> {
  if (isProject(open, projectId)) return open;
  const entries = await createBrowserProjectContent({ fs, logger }).listProjects("");
  const entry = entries.find((candidate) => isProject(candidate, projectId));
  if (!entry) throw new Error(`Project ${projectId} is not in the library folder`);
  return entry;
}

export interface PageProjectLibraryDeps {
  fs: LibraryFileSystem;
  logger: ILogger;
  workspace: Pick<Workspace, "openTab">;
  session: Pick<ProjectSession, "openProject" | "current">;
}

export function createPageProjectLibrary(deps: PageProjectLibraryDeps): ProjectLibraryPort {
  return createBrowserProjectLibrary({ ...deps, pdfjs: browserPdfjs, listPapers: listCachedPaperRecords, askBlank: askBlankProject });
}
