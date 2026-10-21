// Declares what a host supplies to the Spaces pages: the Library, its projects and the actions that leave the page.
import type { SpaceTab } from "./protocol/index.js";
import type { LibraryPapers, SpaceProjectInfo } from "./view/index.js";

/** The implementation binds the host's library, project storage and logger. */
export interface SpacesHostPort {
  /** The current Library snapshot. */
  library(): LibraryPapers;
  /** Returns the function that stops listening. */
  onLibraryChange(listener: () => void): () => void;
  /** Every project the host knows, linked to a Space or not. */
  projects(): Promise<SpaceProjectInfo[]>;
  /** Returns the function that stops listening. */
  onProjectsChange(listener: () => void): () => void;
  openPaper(paperId: string): Promise<void>;
  /** Shows the paper in the Details surface. */
  selectPaper(paperId: string): Promise<void>;
  openProject(projectId: string): Promise<void>;
  openSpace(id: string, tab?: SpaceTab): Promise<void>;
  openCatalog(): Promise<void>;
  /** Lets the user save `text` under the suggested file `name`. */
  saveFile(name: string, text: string): Promise<void>;
}
