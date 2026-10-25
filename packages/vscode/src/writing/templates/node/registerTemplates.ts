// Registers the template gallery commands and wires the gallery to the library, the engine probe and project creation.
import * as vscode from "vscode";

import {
  type FetchLike,
  type TemplateFile,
  type TemplateManifest,
  type LibraryFileSystem,
  type PathOps,
  type TemplateSource,
  type TemplateSourceId,
  createLibraryTemplateSources,
  TEMPLATE_SOURCES,
} from "@labshelf/core";
import { createSessionLogger } from "../../build/node/index.js";
import type { ToolchainDeps } from "../../build/toolchain/index.js";
import { runSafely } from "../../../command/index.js";
import type { WritingHost, WritingProjects } from "../../session/index.js";
import { OPEN_PROJECT_COMMAND } from "../../session/index.js";
import { createTemplateGallery, type TemplateGalleryDeps } from "../index.js";
import { detectEngines } from "./engineAvailability.js";
import { createPublishPorts, type PublishBuilders } from "./publishPorts.js";
import { registerPublishCommand } from "./registerPublishCommand.js";
import { registerProjectTemplateCommand } from "./registerTemplateFromProject.js";

/** The disk and path style the library is on. */
interface LibraryDisk {
  fs: LibraryFileSystem;
  paths: PathOps;
}

/**
 * One source per id that resolves the open library on every call, so the gallery keeps working when the library
 * folder changes; the sources of a library are built once.
 */
function createTemplateSources(host: Pick<WritingHost, "current">, disk: LibraryDisk, fetch: FetchLike): TemplateSource[] {
  let built: { root: string; sources: Record<TemplateSourceId, TemplateSource> } | undefined;
  const current = (): Record<TemplateSourceId, TemplateSource> => {
    const session = host.current();
    if (!session) { throw new Error("Choose a library to browse templates."); }
    if (built?.root !== session.root) {
      built = { root: session.root, sources: createLibraryTemplateSources({ ...disk, libraryRoot: session.root, fetch, logger: session.logger }) };
    }
    return built.sources;
  };
  return TEMPLATE_SOURCES.map((id): TemplateSource => ({
    id,
    list: (signal) => current()[id].list(signal),
    thumbnail: (entry, signal) => current()[id].thumbnail(entry, signal),
    files: (entry, signal) => current()[id].files(entry, signal),
  }));
}

const OPEN_GALLERY_COMMAND = "labshelf.templates.open";

interface TemplatesDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  tex: ToolchainDeps["tex"];
  projects: Pick<WritingProjects, "data" | "fs" | "list" | "paths" | "reload">;
  builders: PublishBuilders;
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

export function registerTemplates(deps: TemplatesDeps): void {
  const { context, host } = deps;
  const version = context.extension.packageJSON.version as string;
  const fetch: FetchLike = (url, init) => globalThis.fetch(url, { ...init, headers: { ...init?.headers, "User-Agent": `LabShelf-VSCode/${version}` } });
  const publishFetch: typeof globalThis.fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("User-Agent", `LabShelf-VSCode/${version}`);
    return globalThis.fetch(input, { ...init, headers });
  };
  const gallery = createTemplateGallery({
    context,
    logger: createSessionLogger(host),
    sources: createTemplateSources(host, deps.projects, fetch),
    engines: () => detectEngines(deps.tex),
    createProject: createProjectInstaller(deps),
    publish: createPublishPorts({ tex: deps.tex, host, projects: deps.projects, builders: deps.builders, fetch: publishFetch }),
  });
  context.subscriptions.push(
    gallery,
    vscode.commands.registerCommand(OPEN_GALLERY_COMMAND, async () => {
      const session = await host.require();
      if (!session) { return; }
      await runSafely(session.logger, OPEN_GALLERY_COMMAND, async () => gallery.open());
    }),
  );
  registerPublishCommand({ context, host, openPublish: gallery.openPublish });
  registerProjectTemplateCommand({ ...deps, onSaved: () => gallery.refresh() });
}
