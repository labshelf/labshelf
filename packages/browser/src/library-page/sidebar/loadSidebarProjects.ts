// Builds the sidebar's Projects section on demand, so a page that hides Projects never loads the project code.
import type { ILogger, LibraryFileSystem } from "@labshelf/core";
import type { TabKindName } from "../tabs";
import type { SidebarProjects, SidebarSession } from "./sidebarProjects";

export async function loadSidebarProjects(logger: ILogger, fileSystem: LibraryFileSystem, session: SidebarSession, openTab: (kind: TabKindName) => void): Promise<SidebarProjects> {
  const [{ createProjectsSource, showPdfInTab }, { createBrowserProjects }, { createSidebarProjects }] = await Promise.all([
    import("../projects"), import("../../storage/projects"), import("./sidebarProjects"),
  ]);
  const source = createProjectsSource({
    projects: createBrowserProjects({ fileSystem, logger }), fileSystem, logger, showPdf: showPdfInTab,
  });
  return createSidebarProjects(source, openTab, session);
}
