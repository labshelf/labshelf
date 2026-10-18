// Declares what creating, adding and deleting projects runs over: the read context plus the device's folder registry.
import type { ProjectReadContext } from "../folder/index.js";

/** The device-local list of project folders kept outside the library, per library root. */
export interface ProjectFolderRegistry {
  folders(libraryRoot: string): Promise<readonly string[]>;
  register(libraryRoot: string, folder: string): Promise<void>;
  /** Forgets a folder; its files stay where they are. */
  unregister(libraryRoot: string, folder: string): Promise<void>;
}

export interface ProjectCatalogContext extends ProjectReadContext {
  registry: ProjectFolderRegistry;
}
