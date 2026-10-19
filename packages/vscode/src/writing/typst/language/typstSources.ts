// Reads the files of a Typst project folder for the language service, preferring text open in editors.
import * as vscode from "vscode";

import type { TypstSources } from "@labshelf/core/typst/language";

const SKIPPED_FOLDERS = new Set(["node_modules"]);

const isSkipped = (name: string): boolean => name.startsWith(".") || SKIPPED_FOLDERS.has(name);

async function walk(folder: vscode.Uri, prefix: string, found: string[]): Promise<void> {
  const entries = await vscode.workspace.fs.readDirectory(folder);
  for (const [name, type] of entries) {
    if (isSkipped(name)) { continue; }
    if (type & vscode.FileType.Directory) {
      await walk(vscode.Uri.joinPath(folder, name), `${prefix}${name}/`, found);
    } else if (type & vscode.FileType.File) {
      found.push(`${prefix}${name}`);
    }
  }
}

/** The files under `root`, with project-relative `/` paths; `read` returns unsaved editor text before the file on disk. */
export function createTypstSources(root: vscode.Uri | undefined): TypstSources {
  return {
    async list() {
      const found: string[] = [];
      if (root) { await walk(root, "", found); }
      return found;
    },
    async read(path) {
      if (!root) { throw new Error(`No project folder to read ${path} from`); }
      const uri = vscode.Uri.joinPath(root, ...path.split("/"));
      const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
      if (open) { return open.getText(); }
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    },
  };
}
