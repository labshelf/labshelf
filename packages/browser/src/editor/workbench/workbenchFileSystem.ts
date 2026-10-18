// Shows the library to the workbench as file:///library/…: projects/ through the project file system, the rest over the library files.
import type { ILogger, LibraryFileSystem } from "@labshelf/core";
import { Emitter } from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import {
  createFileSystemProviderError, FileChangeType, FileSystemProviderCapabilities, FileSystemProviderErrorCode,
  type IFileSystemProviderWithFileReadWriteCapability,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files";
import { PROJECT_SCHEME, type ProjectFileSystemProvider, type ProjectUri } from "../fileSystem";
import { createLibraryFiles } from "./libraryFiles";

// INVARIANT: Tinymist serves only file: and untitled: documents, and LabShelf's web build opens its library as file: paths,
// so the library lives under one file: folder (contract: projects/<id> is a project's folder).
export const LIBRARY_ROOT = "/library";
const PROJECTS_DIR = `${LIBRARY_ROOT}/projects`;

/** vscode.FileChangeType (Changed 1, Created 2, Deleted 3) → the workbench's FileChangeType. */
const CHANGE_TYPES: Readonly<Record<number, FileChangeType>> = {
  1: FileChangeType.UPDATED, 2: FileChangeType.ADDED, 3: FileChangeType.DELETED,
};

export function projectFolderUri(projectId: string): URI {
  return URI.file(`${PROJECTS_DIR}/${projectId}`);
}

type Target = { kind: "project"; uri: ProjectUri } | { kind: "library"; path: string };

function target(resource: URI, access: "read" | "write"): Target {
  const { path } = resource;
  if (path === PROJECTS_DIR || path.startsWith(`${PROJECTS_DIR}/`)) {
    return { kind: "project", uri: { scheme: PROJECT_SCHEME, path: path.slice(PROJECTS_DIR.length) || "/" } };
  }
  if (path === LIBRARY_ROOT || path.startsWith(`${LIBRARY_ROOT}/`)) return { kind: "library", path: path.slice(LIBRARY_ROOT.length + 1) };
  // TRAP: the file: overlay moves on to the next provider only on FileNotFound, so a read outside must fail with exactly that.
  throw createFileSystemProviderError(`${path} is not in the library`,
    access === "read" ? FileSystemProviderErrorCode.FileNotFound : FileSystemProviderErrorCode.NoPermissions);
}

interface WorkbenchFileSystemDeps {
  projects: ProjectFileSystemProvider;
  library: LibraryFileSystem;
  logger: ILogger;
}

export function toWorkbenchProvider({ projects, library, logger }: WorkbenchFileSystemDeps): IFileSystemProviderWithFileReadWriteCapability {
  const files = createLibraryFiles(library, logger);
  const changes = new Emitter<{ type: FileChangeType; resource: URI }[]>();
  // INVARIANT: the page lives as long as the provider, so this subscription is never disposed.
  projects.onDidChangeFile((list) => changes.fire(list.map(({ type, resource }) => ({
    type: CHANGE_TYPES[type] ?? FileChangeType.UPDATED,
    resource: URI.file(`${PROJECTS_DIR}${resource.path}`),
  }))));
  const route = <T>(resource: URI, access: "read" | "write", inProject: (uri: ProjectUri) => Promise<T>, inLibrary: (path: string) => Promise<T>) => {
    const found = target(resource, access);
    return found.kind === "project" ? inProject(found.uri) : inLibrary(found.path);
  };
  return {
    capabilities: FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.PathCaseSensitive,
    onDidChangeCapabilities: new Emitter<void>().event,
    onDidChangeFile: changes.event,
    // Neither store observes outside edits, so there is nothing to watch.
    watch: () => ({ dispose() { return; } }),
    stat: async (resource) => route(resource, "read", (uri) => projects.stat(uri), files.stat),
    readdir: async (resource) => route(resource, "read", (uri) => projects.readDirectory(uri), files.readdir),
    readFile: async (resource) => route(resource, "read", (uri) => projects.readFile(uri), files.readFile),
    writeFile: async (resource, content, opts) => route(resource, "write",
      (uri) => projects.writeFile(uri, content, { create: opts.create, overwrite: opts.overwrite }), (path) => files.writeFile(path, content, opts)),
    mkdir: async (resource) => route(resource, "write", (uri) => projects.createDirectory(uri), files.mkdir),
    delete: async (resource, opts) => route(resource, "write", (uri) => projects.delete(uri, { recursive: opts.recursive }), files.delete),
    rename: async (from, to, opts) => {
      const source = target(from, "write");
      const destination = target(to, "write");
      if (source.kind === "library" && destination.kind === "library") return files.rename(source.path, destination.path, { overwrite: opts.overwrite });
      if (source.kind === "project" && destination.kind === "project") return projects.rename(source.uri, destination.uri, { overwrite: opts.overwrite });
      throw createFileSystemProviderError("Cannot move files into or out of projects", FileSystemProviderErrorCode.NoPermissions);
    },
  };
}
