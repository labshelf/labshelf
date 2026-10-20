// Exposes the template gallery: an editor tab listing templates from every source and creating projects from them.
import type * as vscode from "vscode";
import type { AvailableEngines, ILogger, TemplateFile, TemplateManifest, TemplateSource, PublishPorts } from "@labshelf/core";
import { GalleryPanel } from "./galleryPanel.js";

export interface TemplateGalleryDeps {
  context: vscode.ExtensionContext;
  logger: ILogger;
  sources: readonly TemplateSource[];
  /** Probed by the caller; the gallery asks once per open panel. */
  engines: () => Promise<AvailableEngines>;
  /** Installs the template's files, reloads the projects, and opens the project and its main file. */
  createProject: (title: string, template: TemplateManifest, files: TemplateFile[]) => Promise<void>;
  /** What the Publish screen needs from the app; the gallery adds its logger and the page channel. */
  publish: Omit<PublishPorts, "logger" | "post">;
}

export function createTemplateGallery(deps: TemplateGalleryDeps): { open(): void; openPublish(projectId?: string): Promise<void>; refresh(): void; dispose(): void } {
  let panel: GalleryPanel | undefined;
  const open = (): GalleryPanel => {
    if (panel) { panel.reveal(); return panel; }
    panel = GalleryPanel.open(deps, () => { panel = undefined; });
    return panel;
  };
  return {
    open: () => { open(); },
    openPublish: (projectId) => open().openPublish(projectId),
    refresh: () => panel?.refresh(),
    dispose: () => panel?.dispose(),
  };
}
