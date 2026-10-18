/**
 * Bootstraps the editor page for the project named by `?project=<id>`: the library through the native bridge under file:,
 * the host commands LabShelf's web build calls (LaTeX through the helper, Typst compiled here), the trimmed workbench and the
 * two web extensions. LabShelf opens the project and shows its own preview, as in VS Code.
 */
import { getService, ICommandService, IEditorService } from "@codingame/monaco-vscode-api/services";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { registerFileSystemOverlay } from "@codingame/monaco-vscode-files-service-override";
import type { ILogger, ProjectEntry } from "@labshelf/core";
import { createBrowserLatexHelper, mountHelperSetupCard } from "../helper";
import { bx, createBrowserLogger } from "../platform";
import { createLibraryFileSystem } from "../storage";
import { createBrowserProjects, type BrowserProjects } from "../storage/projects";
import { createProjectFileSystemProvider, type ProjectFileSystemProvider } from "./fileSystem";
import { checkLatexHelper, createEditorHostCommands, createHelperSetupPanel, createHelperSetupShower, registerHostCommands } from "./host";
import { PROJECT_PARAM } from "./pageUrl";
import { createTypstHostCompiler, openPageTypstSession } from "./typst";
import { bootWorkbench, LIBRARY_ROOT, projectFolderUri, registerBundledExtensions, toWorkbenchProvider } from "./workbench";

const MODULE = "editor";
// CONTRACT: VS Code names the command that shows an extension's view container workbench.view.extension.<container id>.
const LABSHELF_VIEW_CONTAINER = "workbench.view.extension.labshelfContainer";
const log = createBrowserLogger();

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

interface HostDeps {
  projectId: string;
  projects: BrowserProjects;
  files: ProjectFileSystemProvider;
  logger: ILogger;
}

/** Registers the host commands and resolves the check that shows the helper setup for a LaTeX project. */
function registerHost({ projectId, projects, files, logger }: HostDeps): (project: ReadyProject) => Promise<void> {
  const helper = createBrowserLatexHelper(logger);
  const showHelperSetup = createHelperSetupShower(createHelperSetupPanel(document.body), helper, (root) => mountHelperSetupCard(root, helper, {
    logger,
    getPlatformInfo: () => bx.runtime.getPlatformInfo(),
    openUrl: (url) => void bx.tabs.create({ url }),
  }));
  const prefix = `/${projectId}/`;
  const onFileWritten = (listener: (relative: string) => void): void => void files.onDidChangeFile((changes) => {
    for (const { resource } of changes) if (resource.path.startsWith(prefix)) listener(resource.path.slice(prefix.length));
  });
  const compileTypst = createTypstHostCompiler({ projectId, logger, open: () => openPageTypstSession({ projects, projectId, logger, onFileWritten }) });
  registerHostCommands(createEditorHostCommands({ helper, logger, libraryFolder: LIBRARY_ROOT, showHelperSetup, compileTypst }));
  return (project) => checkLatexHelper({ helper, logger, showHelperSetup, format: project.settings.format, projectId: project.settings.id });
}

async function boot(): Promise<void> {
  const projectId = new URLSearchParams(location.search).get(PROJECT_PARAM);
  if (!projectId) throw new Error(`The editor page needs a ?${PROJECT_PARAM}=<id> parameter`);
  const container = document.getElementById("workbench");
  if (!container) throw new Error("Missing #workbench");

  const library = createLibraryFileSystem();
  const projects = createBrowserProjects({ fileSystem: library, logger: log });
  const files = createProjectFileSystemProvider({ projects, logger: log });
  registerFileSystemOverlay(1, toWorkbenchProvider({ projects: files, library, logger: log }));
  const project = (await projects.listBrowserProjects()).find((entry): entry is ReadyProject => entry.kind === "ready" && entry.settings.id === projectId);
  if (!project) throw new Error(`No library project has the id ${JSON.stringify(projectId)}`);
  document.title = `${project.settings.title ?? projectId} — LabShelf`;

  const checkHelper = registerHost({ projectId, projects, files, logger: log });
  const folder = projectFolderUri(projectId);
  await bootWorkbench(container, { folder });
  await registerBundledExtensions();
  // The LabShelf side bar (library, project files, outline, checklist) is what a writer works from in VS Code, not the explorer.
  await (await getService(ICommandService)).executeCommand(LABSHELF_VIEW_CONTAINER);
  // The main file shows at once; LabShelf opens the project (preview, views, editor actions) once it has loaded the library.
  if (project.main) await (await getService(IEditorService)).openEditor({ resource: URI.joinPath(folder, project.main) });
  await log.log("INFO", MODULE, "Editor page opened a project", { project: projectId, main: project.main });
  await checkHelper(project);
}

boot().catch((error: unknown) => {
  void log.error(MODULE, error, { action: "boot", url: location.search });
  document.body.dataset.bootError = error instanceof Error ? error.message : String(error);
});
