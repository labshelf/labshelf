// Registers the commands that wrap the active LaTeX or Typst selection in bold or italic.
import * as vscode from "vscode";

import { deriveSelectionWrap, type WrapKind } from "@labshelf/core";

import type { WritingHost } from "./session/index.js";
import { readWritingLanguage } from "./editorLanguage.js";

const COMMANDS: Record<WrapKind, string> = { bold: "labshelf.writing.bold", italic: "labshelf.writing.italic" };

interface EditorActionDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
}

async function wrapActiveSelections(deps: EditorActionDeps, style: WrapKind): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const language = readWritingLanguage(editor);
  if (!editor || !language) { return; }
  const { document } = editor;
  const ordered = [...editor.selections].sort((a, b) => document.offsetAt(a.start) - document.offsetAt(b.start));
  // Offsets are read before the edit, because the document changes under the selections afterwards.
  const spans = ordered.map((selection) => ({ start: document.offsetAt(selection.start), end: document.offsetAt(selection.end) }));
  const wraps = ordered.map((selection) => deriveSelectionWrap(language, style, document.getText(selection)));
  const applied = await editor.edit((builder) => {
    ordered.forEach((selection, index) => builder.replace(selection, wraps[index]!.text));
  });
  if (!applied) {
    await deps.host.current()?.logger.log("WARN", "writing/editorActions", "Editor rejected the wrap edit", { style, language });
    return;
  }
  // The edits shift every later selection by the length change of the earlier ones.
  let shift = 0;
  editor.selections = spans.map((span, index) => {
    const { text, cursor } = wraps[index]!;
    const start = span.start + shift;
    shift += text.length - (span.end - span.start);
    return cursor === undefined
      ? new vscode.Selection(document.positionAt(start), document.positionAt(start + text.length))
      : new vscode.Selection(document.positionAt(start + cursor), document.positionAt(start + cursor));
  });
}

export function registerEditorActions(deps: EditorActionDeps): void {
  for (const style of Object.keys(COMMANDS) as WrapKind[]) {
    deps.context.subscriptions.push(vscode.commands.registerCommand(COMMANDS[style], () => wrapActiveSelections(deps, style)));
  }
}
