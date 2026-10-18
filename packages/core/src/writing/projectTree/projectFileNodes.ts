// Lists a project folder's entries as Files-tree rows: hidden entries dropped, folders first, the main file and format sources marked.
import type { SidebarTreeNode } from "../../library-ui/index.js";
import { fileIcon } from "../../library-ui/index.js";
import type { ProjectFormat } from "../project/index.js";

/** An entry of a folder as read from disk. */
export interface DirectoryEntry {
  name: string;
  folder: boolean;
}

/** folder: expands; source: a file of the project's format that is not the main file and can become it. */
export type ProjectFileKind = "folder" | "file" | "source";

export interface ProjectFileRow {
  kind: ProjectFileKind;
  node: SidebarTreeNode;
}

export interface ProjectFileContext {
  /** Undefined without an open project, where no file is a source. */
  format: ProjectFormat | undefined;
  /** The main file's path relative to the project folder, with "/" separators. */
  main: string | undefined;
}

// Build output lives in the cache, outside the project, so only these folders are not the user's sources.
const HIDDEN_NAMES = new Set([".git", ".labshelf"]);

/** The entries the Files tree shows: folders first, then by name. */
export function visibleEntries<T extends DirectoryEntry>(entries: readonly T[]): T[] {
  return entries
    .filter(({ name }) => !HIDDEN_NAMES.has(name))
    .sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name));
}

const withoutDots = (path: string): string => path.split("/").filter((part) => part !== "" && part !== ".").join("/");

/** @param path the entry's path relative to the project folder, with "/" separators */
export function projectFileRow(path: string, folder: boolean, context: ProjectFileContext): ProjectFileRow {
  const name = path.split("/").pop() ?? path;
  if (folder) { return { kind: "folder", node: { key: path, label: name, icon: { kind: "glyph", name: "folder" }, children: [], open: false } }; }
  const main = context.main !== undefined && withoutDots(context.main) === path;
  const source = context.format !== undefined && name.toLowerCase().endsWith(context.format === "latex" ? ".tex" : ".typ");
  return {
    // A source of the project's format that is not already the main file can become it.
    kind: !main && source ? "source" : "file",
    node: { key: path, label: name, icon: fileIcon(name), clickable: true, ...(main ? { description: "main" } : {}) },
  };
}
