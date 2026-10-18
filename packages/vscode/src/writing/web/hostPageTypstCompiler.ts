// Compiles Typst through the command the web editor page registers for its in-page compiler.
// CONTRACT: documents/contracts/editor-host.md#typst-compiler
import * as vscode from "vscode";

import { typstOutcomeFromWire, type TypstHostOutcome, type TypstHostRequest } from "@labshelf/core/helper";

export const TYPST_COMPILE_COMMAND = "labshelf.editorHost.typstCompile";

/** Rejects when the page has no such command, as any web host other than the editor page. */
export async function compileTypstOnHostPage(request: TypstHostRequest): Promise<TypstHostOutcome> {
  return typstOutcomeFromWire(await vscode.commands.executeCommand<unknown>(TYPST_COMPILE_COMMAND, request));
}
