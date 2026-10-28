// Declares what a host supplies to the Spaces pages: the Library, its projects and the actions that leave the page.
import type { SpaceTab } from "./spacesProtocol.js";
import type { LibraryPapers, SpaceProjectEntry } from "./spaceViews.js";

/** The implementation binds the host's library, project storage and logger. */
export interface SpacesHostPort {
  library(): LibraryPapers;
  onLibraryChange(listener: () => void): () => void;
  /** Every project the host knows, linked to a Space or not. */
  projects(): Promise<SpaceProjectEntry[]>;
  onProjectsChange(listener: () => void): () => void;
  openPaper(paperId: string): Promise<void>;
  /** Shows the paper in the Details surface. */
  selectPaper(paperId: string): Promise<void>;
  openProject(projectId: string): Promise<void>;
  openSpace(id: string, tab?: SpaceTab): Promise<void>;
  openCatalog(): Promise<void>;
  saveFile(name: string, text: string): Promise<void>;
}
