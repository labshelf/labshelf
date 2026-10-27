// Registers the source-aware LaTeX editing features: command and environment completion, \begin auto-close, outline, word count and math hover.
import * as vscode from "vscode";

import {
  COLOR_TOKENS,
  LATEX_COMMANDS,
  LATEX_ENVIRONMENTS,
  type DesignToken,
  type LatexCatalogEntry,
  type MacroFact,
  countWords,
  createKeyedDebouncer,
  deriveMathJaxMacros,
  findEnvironmentToClose,
  findLatexCompletionSpan,
  formatError,
  scanLatexSource,
} from "@labshelf/core";
import { findMathSpan, createMathImageUri, renderMathSvg } from "@labshelf/core/math";
import { registerLabelProviders } from "./labels.js";
import { LatexProjectSources, deriveVscodeRange, type LatexProjectWorkspace } from "./project.js";
import { deriveNestedSymbols } from "../writing/projects/index.js";

const NEWLINE_WITH_INDENT = /^\r?\n([ \t]*)$/;

interface Trigger {
  /** Where the cursor is after the change. */
  cursor: vscode.Position;
  beginLine: number;
  /** The text of the begin line up to the change, which must end in the \begin. */
  lineBeforeEnd: string;
}

function typedBrace(document: vscode.TextDocument, change: vscode.TextDocumentContentChangeEvent): Trigger | undefined {
  if (change.text !== "}" || change.rangeLength !== 0) { return undefined; }
  const { line, character } = change.range.start;
  return {
    cursor: new vscode.Position(line, character + 1),
    beginLine: line,
    lineBeforeEnd: document.lineAt(line).text.slice(0, character + 1),
  };
}

// Enter only counts at the end of the \begin line: nothing but the auto-indent may follow the new cursor.
function enteredNewline(document: vscode.TextDocument, change: vscode.TextDocumentContentChangeEvent): Trigger | undefined {
  const indent = NEWLINE_WITH_INDENT.exec(change.text)?.[1];
  if (indent === undefined || change.rangeLength !== 0) { return undefined; }
  const { line, character } = change.range.start;
  const cursor = new vscode.Position(line + 1, indent.length);
  if (document.lineAt(cursor.line).text.slice(cursor.character).trim() !== "") { return undefined; }
  return { cursor, beginLine: line, lineBeforeEnd: document.lineAt(line).text.slice(0, character) };
}

function closeEnvironment(document: vscode.TextDocument, trigger: Trigger): void {
  const name = findEnvironmentToClose(trigger.lineBeforeEnd, () => document.getText().slice(document.offsetAt(trigger.cursor)));
  if (name === undefined) { return; }
  const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document === document);
  if (!editor) { return; }
  const indent = /^\s*/.exec(document.lineAt(trigger.beginLine).text)![0];
  void editor.edit((builder) => builder.insert(trigger.cursor, `\n${indent}\\end{${name}}`)).then((applied) => {
    if (applied) { editor.selection = new vscode.Selection(trigger.cursor, trigger.cursor); }
  });
}

export function registerLatexEnvironmentAutoClose(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
    const { document, contentChanges, reason } = event;
    // A set reason is an undo or redo; replaying it must not add another \end.
    if (document.languageId !== "latex" || reason !== undefined || contentChanges.length !== 1) { return; }
    const change = contentChanges[0]!;
    const trigger = typedBrace(document, change) ?? enteredNewline(document, change);
    if (trigger) { closeEnvironment(document, trigger); }
  }));
}

// "1" ranks catalog items after the library papers the citation provider ranks with "0".
function sortText(entry: LatexCatalogEntry): string {
  return `1${entry.name}`;
}

function commandItem(entry: LatexCatalogEntry, range: vscode.Range): vscode.CompletionItem {
  const item = new vscode.CompletionItem(`\\${entry.name}`, vscode.CompletionItemKind.Function);
  item.detail = entry.detail;
  item.sortText = sortText(entry);
  item.insertText = new vscode.SnippetString(`\\${entry.snippet}`);
  item.range = range;
  return item;
}

// A \begin item also writes its body and the matching \end, so the environment is never left open.
function environmentItem(entry: LatexCatalogEntry, closing: boolean, range: vscode.Range): vscode.CompletionItem {
  const item = new vscode.CompletionItem(entry.name, vscode.CompletionItemKind.Snippet);
  item.detail = entry.detail;
  item.sortText = sortText(entry);
  item.insertText = new vscode.SnippetString(
    closing ? `${entry.name}}` : `${entry.name}}${entry.snippet}\n\\end{${entry.name}}`,
  );
  item.range = range;
  return item;
}

export class LatexCommandCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
    const line = document.lineAt(position.line).text;
    const span = findLatexCompletionSpan(line.slice(0, position.character), line.slice(position.character));
    if (span === undefined) { return undefined; }
    if (span.kind === "environment") {
      const range = new vscode.Range(position.line, position.character - span.before, position.line, position.character + span.after);
      return LATEX_ENVIRONMENTS.map((entry) => environmentItem(entry, span.closing, range));
    }
    const range = new vscode.Range(position.line, position.character - span.before, position.line, position.character);
    return LATEX_COMMANDS.map((entry) => commandItem(entry, range));
  }
}

export function registerLatexCommandCompletion(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider({ language: "latex" }, new LatexCommandCompletionProvider(), "\\", "{"),
  );
  registerLatexEnvironmentAutoClose(context);
}

export function createMathHoverProvider(sources: LatexProjectSources): vscode.HoverProvider {
  return {
    async provideHover(document, position) {
      const text = document.getText();
      const span = findMathSpan(text, document.offsetAt(position));
      if (!span) return undefined;
      const range = new vscode.Range(document.positionAt(span.start), document.positionAt(span.end));
      const macros = deriveMathJaxMacros(await macrosFor(document, sources, text));
      return new vscode.Hover(previewMarkdown(span.tex, span.display, macros), range);
    },
  };
}

// A file outside a project still gets the macros it defines itself.
async function macrosFor(document: vscode.TextDocument, sources: LatexProjectSources, text: string): Promise<MacroFact[]> {
  const project = await sources.projectSourcesFor(document);
  return project ? project.files.flatMap((file) => file.facts.macros) : scanLatexSource(text).macros;
}

function previewMarkdown(tex: string, display: boolean, macros: ReturnType<typeof deriveMathJaxMacros>): vscode.MarkdownString {
  try {
    const colors = { text: themed(COLOR_TOKENS.fg), error: themed(COLOR_TOKENS.error) };
    return new vscode.MarkdownString(`![math](${createMathImageUri(renderMathSvg(tex, display, macros), colors)})`);
  } catch (error) {
    // The message is TeX's own parse error, which is what the writer needs to fix the math.
    const message = formatError(error);
    const markdown = new vscode.MarkdownString();
    markdown.appendText(`Math preview: ${message}`);
    return markdown;
  }
}

function themed(token: DesignToken): string {
  const kind = vscode.window.activeColorTheme.kind;
  const light = kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight;
  return light && token.light !== undefined ? token.light : token.value;
}

export function listSectionSymbols(text: string, endOfFile: vscode.Position): vscode.DocumentSymbol[] {
  const { sections } = scanLatexSource(text);
  return deriveNestedSymbols(
    sections.map((section) => ({
      level: section.level,
      name: section.title || "(untitled)",
      // Levels run from part (-1) to subparagraph (5).
      depth: section.level + 1,
      selection: deriveVscodeRange(section.range),
    })),
    endOfFile,
  );
}

export function registerSectionOutline(context: vscode.ExtensionContext, sources: LatexProjectSources): void {
  const provider: vscode.DocumentSymbolProvider = {
    provideDocumentSymbols(document) {
      if (!sources.projectOf(document.uri)) { return undefined; }
      const text = document.getText();
      return listSectionSymbols(text, document.positionAt(text.length));
    },
  };
  context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider({ scheme: "file", pattern: "**/*.tex" }, provider));
}

function wordsLabel(count: number): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "word" : "words"}`;
}

function wordCountTooltip(fileCount: number, mainFile: string): string {
  return `Words in the whole project, counted from ${mainFile}. This file: ${wordsLabel(fileCount)}.`;
}

const REFRESH_DELAY_MS = 300;

export function registerWordCount(context: vscode.ExtensionContext, sources: LatexProjectSources): void {
  // Priority 48 places it right after the compiler item (49).
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 48);
  let latest = 0;

  const update = async (): Promise<void> => {
    const ticket = ++latest;
    const document = vscode.window.activeTextEditor?.document;
    const project = document && await sources.projectSourcesFor(document);
    // A slower, older update must not overwrite a newer one.
    if (ticket !== latest) { return; }
    if (!document || !project) {
      item.hide();
      return;
    }
    const total = [...project.texts.values()].reduce((sum, text) => sum + countWords(text), 0);
    item.text = `$(book) ${wordsLabel(total)}`;
    item.tooltip = wordCountTooltip(countWords(document.getText()), project.main);
    item.show();
  };

  const refresh = createKeyedDebouncer<string>(REFRESH_DELAY_MS, () => void update());
  const onSourcesChanged = (folder: string): void => {
    const active = vscode.window.activeTextEditor?.document;
    if (active && sources.projectOf(active.uri)?.folder === folder) { refresh.call(folder); }
  };
  context.subscriptions.push(
    item, { dispose: () => refresh.dispose() },
    sources.onDidChange(onSourcesChanged),
    vscode.window.onDidChangeActiveTextEditor(() => void update()),
  );
  void update();
}

/** Returns the project sources service so other LaTeX features read the same cache. */
/** Returns the project sources service so other LaTeX features read the same cache. */
export function registerLatexEditing(context: vscode.ExtensionContext, workspace: LatexProjectWorkspace): LatexProjectSources {
  const sources = new LatexProjectSources(workspace);
  context.subscriptions.push(sources);
  registerLabelProviders(context, sources);
  registerSectionOutline(context, sources);
  registerWordCount(context, sources);
  context.subscriptions.push(vscode.languages.registerHoverProvider({ language: "latex" }, createMathHoverProvider(sources)));
  return sources;
}
