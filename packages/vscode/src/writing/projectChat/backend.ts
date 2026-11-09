// Holds what the Project chat needs from collaboration, which provides it where projects can be shared, and the projects whose chat exists:
// the open project while it is shared and that backend is there.
import * as vscode from "vscode";
import type { ProjectChatPresence, ProjectChatStore } from "@labshelf/core";

/** Collaboration's side of the Project chat. */
export interface ProjectChatBackend {
  readonly store: ProjectChatStore;
  /** The user's name, stamped on their messages and the one peers see in presence. */
  author(): string;
  /** The chat presence of the project's share; it follows the share's connection as it opens, closes or is replaced. */
  presence(shareId: string): ProjectChatPresence;
}

let backend: ProjectChatBackend | undefined;
const backendChanged = new vscode.EventEmitter<void>();

/** The backend collaboration provided, or undefined where projects cannot be shared, as on the web. */
export const projectChatBackend = {
  current: (): ProjectChatBackend | undefined => backend,
  onDidChange: backendChanged.event,
};

/** Called by collaboration once it runs; the returned disposable withdraws the backend. */
export function provideProjectChatBackend(next: ProjectChatBackend): vscode.Disposable {
  backend = next;
  backendChanged.fire();
  return new vscode.Disposable(() => {
    if (backend !== next) { return; }
    backend = undefined;
    backendChanged.fire();
  });
}

const chatFolders = new Set<string>();
const foldersChanged = new vscode.EventEmitter<void>();

/** Which project folders have a chat (the open project, when shared), for the LabShelf editor's chat icon (D2). */
export const projectChatAvailability = {
  isAvailable: (projectFolder: string): boolean => chatFolders.has(projectFolder),
  onDidChange: foldersChanged.event,
};

/** Replaces the folders with a chat; fires only when they differ. */
export function setProjectChatFolders(folders: readonly string[]): void {
  if (folders.length === chatFolders.size && folders.every((folder) => chatFolders.has(folder))) { return; }
  chatFolders.clear();
  folders.forEach((folder) => chatFolders.add(folder));
  foldersChanged.fire();
}
