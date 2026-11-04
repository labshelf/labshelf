// Declares what a host supplies to the Spaces pages (the Library, its projects, sharing and the actions that leave the page) and runs the share actions on it.
import type { HostToSpaces, SpacePapersDownload, SpaceShareView, SpacesToHost, SpaceTab } from "./spacesProtocol.js";
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
  /** Shares the Space live; absent where the host cannot share, and the page keeps its planned notice. */
  shareSpace?(id: string): Promise<void>;
  /** Stops sharing on this device and keeps the Space's files. */
  leaveSpace?(id: string): Promise<void>;
  spaceShareState?(id: string): SpaceShareView;
  onSpaceShareChange?(listener: () => void): () => void;
  /** Asks the user for a library folder, then fetches the papers from the peers; absent where the host cannot download. */
  downloadSpacePapers?(id: string, what: SpacePapersDownload): Promise<void>;
}

export type ShareAction = Extract<SpacesToHost, { type: "shareSpace" | "leaveSpace" | "downloadSpacePapers" }>;

/** Runs the action on the host; rejects when the host lacks the method, so the server posts the error of the action. */
export function runShareAction(port: SpacesHostPort, message: ShareAction): Promise<void> {
  switch (message.type) {
    case "shareSpace": return port.shareSpace?.(message.id) ?? Promise.reject(new Error("Sharing is not available here."));
    case "leaveSpace": return port.leaveSpace?.(message.id) ?? Promise.reject(new Error("Sharing is not available here."));
    case "downloadSpacePapers": return port.downloadSpacePapers?.(message.id, message.what) ?? Promise.reject(new Error("Downloading papers is not available here."));
  }
}

/** What the Space view says about sharing and downloading: what the host can do, and the share's state when it can share. */
export function shareFields(port: SpacesHostPort, id: string): Pick<Extract<HostToSpaces, { type: "space" }>, "canShare" | "canDownload" | "share"> {
  return {
    ...(port.shareSpace ? { canShare: true } : {}),
    ...(port.downloadSpacePapers ? { canDownload: true } : {}),
    ...(port.spaceShareState ? { share: port.spaceShareState(id) } : {}),
  };
}
