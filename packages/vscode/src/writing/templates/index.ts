// Exposes the template gallery: an editor tab listing templates from every source and creating projects from them.
import type * as vscode from "vscode";
import type { AvailableEngines, ILogger, TemplateFile, TemplateManifest, TemplateSource } from "@labshelf/core";
import { GalleryPanel } from "./galleryPanel.js";

export interface TemplateGalleryDeps {
  context: vscode.ExtensionContext;
  logger: ILogger;
  sources: readonly TemplateSource[];
  /** Probed by the caller; the gallery asks once per open panel. */
  engines: () => Promise<AvailableEngines>;
  /** Installs the template's files, reloads the projects, and opens the project and its main file. */
  createProject: (title: string, template: TemplateManifest, files: TemplateFile[]) => Promise<void>;
}

export function createTemplateGallery(deps: TemplateGalleryDeps): { open(): void; refresh(): void; dispose(): void } {
  let panel: GalleryPanel | undefined;
  return {
    open: () => {
      if (panel) { panel.reveal(); return; }
      panel = GalleryPanel.open(deps, () => { panel = undefined; });
    },
    refresh: () => panel?.refresh(),
    dispose: () => panel?.dispose(),
  };
}
