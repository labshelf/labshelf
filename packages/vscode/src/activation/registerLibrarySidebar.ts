// Registers the Library sidebar webview and the helpers other registration modules use to sync or refresh it.
import * as vscode from "vscode";

import { createLibraryLayout } from "@labshelf/core";
import {
  LibrarySidebarView,
  ListWebviewPanel,
  type LibraryNode,
  type SidebarProjectTreesDep,
  type SidebarProjectsDep,
  type SidebarSpacesDep,
} from "../libraryUi/index.js";
import { importPapers, moveFolders, type FolderCommandHost } from "../command/index.js";
import type { LibraryEvents } from "../library/index.js";
import type { LibraryRootController } from "./libraryRootController.js";
import type { HostAdapters } from "./hostAdapters.js";

export interface LibrarySidebarDeps {
  context: vscode.ExtensionContext;
  events: LibraryEvents;
  controller: LibraryRootController;
  papersRootUri: () => vscode.Uri | null;
  folderHost: FolderCommandHost;
  adapters: HostAdapters;
  /** The writing projects the Projects section lists. */
  projects: SidebarProjectsDep;
  spaces?: SidebarSpacesDep;
  /** The open project's trees the Projects section shows. */
  projectTrees: SidebarProjectTreesDep;
}

export interface LibrarySidebarResult {
  librarySidebar: LibrarySidebarView;
  /** Selects the folder the list panel shows. */
  showFolderInSidebar: (folder?: LibraryNode) => void;
  /** Selects a paper's row; called when the list panel selects a paper. */
  showPaperInSidebar: (paperId: string) => void;
  refreshLibraryViews: () => void;
}

export function registerLibrarySidebar(deps: LibrarySidebarDeps): LibrarySidebarResult {
  const { context, events, controller, papersRootUri, folderHost, adapters, projects, projectTrees } = deps;
  const view = new LibrarySidebarView({
    extensionUri: context.extensionUri,
    getSnapshot: () => controller.currentServices()?.library.snapshot,
    events,
    paths: adapters.paths,
    projects,
    projectTrees,
    ...(deps.spaces ? { spaces: deps.spaces } : {}),
    importFiles: async (uris, targetDir) => {
      const services = await folderHost.requireServices();
      if (services) { await importPapers(services, uris, targetDir); }
    },
    moveFolder: (sourceDir, targetDir) => moveFolders(folderHost, [sourceDir], targetDir),
  });
  context.subscriptions.push(view, vscode.window.registerWebviewViewProvider("labshelf.library", view));
  const initialRoot = papersRootUri();
  if (initialRoot) { view.setLibrary(initialRoot); }
  controller.onDidChangeRoot(({ root }) => {
    view.setLibrary(createLibraryLayout(root, vscode.Uri.joinPath).papersRoot());
  });

  return {
    librarySidebar: view,
    showFolderInSidebar: (folder) => { if (folder) { view.showFolder(folder); } },
    showPaperInSidebar: (paperId) => view.showPaper(paperId),
    // Folder structure changed on disk: refresh both the sidebar and the open panel.
    refreshLibraryViews: () => {
      view.refresh();
      void ListWebviewPanel.currentPanel?.refresh();
    },
  };
}
