// Where a manuscript's code listings read their files in VS Code: relative to the project folder, inside a workspace folder, from the open document when there is one.
// CONTRACT: documents/contracts/library-format.md#code-listings
import * as vscode from "vscode";
import { deriveCodeLanguage, isInside, type CodeLinkSource, type PathOps } from "@labshelf/core";

/** The absolute file a listing's path names; it may climb out of the project folder but never out of every workspace folder. */
function resolveCodeFile(paths: PathOps, folder: string, path: string): string {
  const file = paths.resolve(folder, ...path.split("/"));
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (!folders.some((each) => isInside(paths, each.uri.fsPath, file))) { throw new Error(`${path} is outside the workspace`); }
  return file;
}

/** A code file that does not exist reads as undefined; one outside the workspace throws, so its listing gets no mark. */
export function createCodeLinkSource(paths: PathOps, folder: string): CodeLinkSource {
  return {
    async read(path) {
      const file = resolveCodeFile(paths, folder, path);
      const open = vscode.workspace.textDocuments.find((document) => document.uri.scheme === "file" && document.uri.fsPath === file);
      if (open) { return open.getText(); }
      const uri = vscode.Uri.file(file);
      try {
        if ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) { return undefined; }
      } catch (error) {
        if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") { return undefined; }
        throw error;
      }
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    },
  };
}

/** A file whose saves and changes can move a listing's state or that can be inserted as code: a known code language, a LaTeX file excluded. */
export const isCodeFile = (path: string): boolean => !/\.tex$/i.test(path) && deriveCodeLanguage(path.replace(/\\/g, "/")) !== undefined;
