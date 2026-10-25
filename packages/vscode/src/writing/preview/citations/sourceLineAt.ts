// Finds the LaTeX source line behind a point of the preview through SyncTeX, reading the open editor's text before the file on disk.
import { sourceAt, type PagePoint, type SourceLine } from "@labshelf/core";
import type { SynctexLookup } from "../synctex/index.js";
import * as vscode from "vscode";

/** The text of a file as the user sees it: the open document's, saved or not. */
async function currentText(file: string): Promise<string> {
  const open = vscode.workspace.textDocuments.find((document) => document.uri.fsPath === file);
  return open ? open.getText() : new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(file)));
}

/** A source line with the file it belongs to. */
export interface LocatedSourceLine extends SourceLine {
  file: string;
}

/** `undefined` when the project has no SyncTeX data or nothing of the source lies at the point. */
export async function sourceLineAt(synctex: () => Promise<SynctexLookup>, point: PagePoint): Promise<LocatedSourceLine | undefined> {
  const lookup = await synctex();
  if (lookup.status !== "found") { return undefined; }
  const source = sourceAt(lookup.index, point);
  return source ? { file: source.file, text: await currentText(source.file), line: source.line } : undefined;
}
