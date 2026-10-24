// Declares the host actions available from the Spaces sidebar section.
import type { SidebarRow } from "../../../../spaces/viewModel/index.js";

export interface SidebarSpaceActions {
  openCatalog(): void;
  openSpace(id: string, folder?: string): void;
  openPaper(id: string): void;
  newSpace(): void;
  renameSpace(id: string): void;
  deleteSpace(id: string): void;
  newFolder(spaceId: string, parent?: string): void;
  renameFolder(spaceId: string, folder: string): void;
  deleteFolder(spaceId: string, folder: string): void;
  dropPapers(spaceId: string, folder: string | undefined, paperIds: string[]): void;
  removeReference(spaceId: string, paperId: string): void;
}

export interface SidebarSpacesState {
  spaces: SidebarSpaceActions | undefined;
  spaceList: readonly SidebarRow[];
  expanded: Set<string>;
  saveExpanded(paths: string[]): void;
}
