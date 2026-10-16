// Registers the template gallery commands and wires the gallery to the library, the engine probe and project creation.
import * as vscode from "vscode";

import type { FetchLike, ILogger, TemplateFile, TemplateManifest } from "@labshelf/core";
import { executeSafely } from "../../../commands/index.js";
import type { WritingHost, WritingProjects } from "../../session/index.js";
import { OPEN_PROJECT_COMMAND } from "../../session/index.js";
import { createTemplateGallery, type TemplateGalleryDeps } from "../index.js";
import { detectEngines } from "./engineAvailability.js";
import { registerSaveProjectCommand } from "./saveProjectCommand.js";
import { createTemplateSources } from "./templateSources.js";

const OPEN_GALLERY_COMMAND = "labshelf.templates.open";

interface TemplatesDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "reload">;
}

/** Installs the template into the library's projects and opens the new project, which opens its main file. */
export function createProjectInstaller({ host, projects }: Pick<TemplatesDeps, "host" | "projects">): TemplateGalleryDeps["createProject"] {
  return async (title: string, template: TemplateManifest, files: TemplateFile[]): Promise<void> => {
    const session = await host.require();
    if (!session) { throw new Error("Choose a library to create the project in."); }
    const entry = await projects.data.createProjectFromTemplate(session.root, { title, template, files });
    await projects.reload();
    await vscode.commands.executeCommand(OPEN_PROJECT_COMMAND, entry);
  };
}

// The library can change while the gallery lives, so each entry goes to the logger of the library open at that moment.
function libraryLogger(host: Pick<WritingHost, "current">): ILogger {
  return {
    log: async (...args) => { await host.current()?.logger.log(...args); },
    error: async (...args) => { await host.current()?.logger.error(...args); },
  };
}

export function registerTemplates(deps: TemplatesDeps): void {
  const { context, host } = deps;
  const version = context.extension.packageJSON.version as string;
  const fetch: FetchLike = (url, init) => globalThis.fetch(url, { ...init, headers: { ...init?.headers, "User-Agent": `LabShelf-VSCode/${version}` } });
  const gallery = createTemplateGallery({
    context,
    logger: libraryLogger(host),
    sources: createTemplateSources(host, fetch),
    engines: detectEngines,
    createProject: createProjectInstaller(deps),
  });
  context.subscriptions.push(
    gallery,
    vscode.commands.registerCommand(OPEN_GALLERY_COMMAND, async () => {
      const session = await host.require();
      if (!session) { return; }
      await executeSafely(session.logger, OPEN_GALLERY_COMMAND, async () => gallery.open());
    }),
  );
  registerSaveProjectCommand({ ...deps, onSaved: () => gallery.refresh() });
}
