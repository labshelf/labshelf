/**
 * Bootstraps the editor page for the project named by `?project=<id>`: the library through the native bridge under file:,
 * the host commands LabShelf's web build calls, the trimmed workbench, the two web extensions, and the side pane.
 */
import { getService, IEditorService } from "@codingame/monaco-vscode-api/services";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { registerFileSystemOverlay } from "@codingame/monaco-vscode-files-service-override";
import type { ILogger, ProjectEntry } from "@labshelf/core";
import { createBrowserLatexHelper, mountHelperSetupCard } from "../helper";
import { bx, createBrowserLogger } from "../platform";
import { createLibraryFileSystem } from "../storage";
import { createBrowserProjects, type BrowserProjects } from "../storage/projects";
import { createProjectFileSystemProvider, type ProjectFileSystemProvider } from "./fileSystem";
import { checkLatexHelper, createEditorHostCommands, createHelperSetupShower, registerHostCommands } from "./host";
import { PROJECT_PARAM } from "./pageUrl";
import { createSidePane, startTypstPreview, type SidePane } from "./preview";
import { bootWorkbench, LIBRARY_ROOT, projectFolderUri, registerBundledExtensions, toWorkbenchProvider } from "./workbench";

const MODULE = "editor";
const log = createBrowserLogger();

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

/** Registers the host commands and resolves the check that shows the helper setup for a LaTeX project. */
function registerHost(pane: SidePane, logger: ILogger): (project: ReadyProject) => Promise<void> {
  const helper = createBrowserLatexHelper(logger);
  const showHelperSetup = createHelperSetupShower(pane.setup, helper, (root) => mountHelperSetupCard(root, helper, {
    logger,
    getPlatformInfo: () => bx.runtime.getPlatformInfo(),
    openUrl: (url) => void bx.tabs.create({ url }),
  }));
  registerHostCommands(createEditorHostCommands({
    helper, logger, libraryFolder: LIBRARY_ROOT, showHelperSetup,
    onProgress: (progress) => pane.status(`LaTeX: ${progress.phase}…`),
  }));
  return (project) => checkLatexHelper({ helper, logger, showHelperSetup, format: project.settings.format, projectId: project.settings.id });
}

function previewTypst(project: ReadyProject, projects: BrowserProjects, files: ProjectFileSystemProvider, pane: SidePane): void {
  if (project.settings.format !== "typst" || !project.main) return;
  const projectId = project.settings.id;
  const prefix = `/${projectId}/`;
  void startTypstPreview({
    projects, projectId, main: project.main, folder: projectFolderUri(projectId), pane, logger: log,
    onFileWritten: (listener) => files.onDidChangeFile((changes) => {
      for (const { resource } of changes) if (resource.path.startsWith(prefix)) listener(resource.path.slice(prefix.length));
    }),
  }).catch((error: unknown) => {
    pane.status("The preview could not start; see the log.");
    void log.error(MODULE, error, { project: projectId, action: "start the Typst preview" });
  });
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

  const pane = createSidePane(document.body);
  const checkHelper = registerHost(pane, log);
  const folder = projectFolderUri(projectId);
  await bootWorkbench(container, { folder });
  await registerBundledExtensions();
  if (project.main) await (await getService(IEditorService)).openEditor({ resource: URI.joinPath(folder, project.main) });
  await log.log("INFO", MODULE, "Editor page opened a project", { project: projectId, main: project.main });
  previewTypst(project, projects, files, pane);
  await checkHelper(project);
}

boot().catch((error: unknown) => {
  void log.error(MODULE, error, { action: "boot", url: location.search });
  document.body.dataset.bootError = error instanceof Error ? error.message : String(error);
});
