// Builds the All projects port of the library page, the one both the All projects tab and the Details pane serve.
import type { ILogger, LibraryFileSystem, ProjectLibraryPort } from "@labshelf/core";
import { listCachedPaperRecords } from "../../storage";
import type { ProjectSession } from "../session";
import type { Workspace } from "../../libraryUi/editorArea";
import { askBlankProject } from "./askProject";
import { browserPdfjs } from "./browserPdfjs";
import { createBrowserProjectLibrary } from "./browserProjectLibrary";

export interface PageProjectLibraryDeps {
  fs: LibraryFileSystem;
  logger: ILogger;
  workspace: Pick<Workspace, "openTab">;
  session: Pick<ProjectSession, "openProject" | "current">;
}

export function createPageProjectLibrary(deps: PageProjectLibraryDeps): ProjectLibraryPort {
  return createBrowserProjectLibrary({ ...deps, pdfjs: browserPdfjs, listPapers: listCachedPaperRecords, askBlank: askBlankProject });
}
