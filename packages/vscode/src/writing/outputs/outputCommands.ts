// The linked-output commands: Link Output… (the LabShelf editor's own dialog, or quick picks in the native editor), Run, Update, Link to code and Source settings, and the hover and lenses they serve.
// CONTRACT: documents/contracts/library-format.md#linked-outputs
import * as vscode from "vscode";

import { formatError, isOutputSourceName, listOutputValueKeys, loadsBooktabs, type OutputCreateInput, type OutputKind } from "@labshelf/core";
import { insertBlock, readManuscriptLanguage } from "../citations/linkMarks.js";
import type { ActiveSource } from "../activeSource.js";
import type { WritingProjects } from "../projects/index.js";
import { OUTPUT_KIND_LABELS, deriveOutputKindChoices, describeOutputRun, filterLinkableOutputs, parseDecimalsInput } from "./outputChoices.js";
import { OUTPUT_COMMANDS, createOutputHoverProvider, createOutputLensProvider, openManuscriptOutputs, type ManuscriptOutputs, type NativeOutputDeps } from "./outputLenses.js";
import { openProjectOutputs } from "./projectOutputs.js";

const MODULE = "writing/outputs";
const OUTPUTS_AVAILABLE_KEY = "labshelf.writing.outputsAvailable";
const LINK_OUTPUT_COMMAND = "labshelf.writing.linkOutput";

export interface OutputCommandDeps extends NativeOutputDeps {
  projects: Pick<WritingProjects, "list" | "paths" | "fs" | "onDidChange">;
  activeSource: Pick<ActiveSource, "current">;
}

/** A command's document argument: a Uri from a lens, its string from a hover link. */
const toUri = (value: vscode.Uri | string): vscode.Uri => typeof value === "string" ? vscode.Uri.parse(value) : value;

function outputsOf(deps: NativeOutputDeps, uri: vscode.Uri): ManuscriptOutputs | undefined {
  const opened = openManuscriptOutputs(deps, uri.fsPath);
  if (!opened) { void vscode.window.showInformationMessage("This file is not a manuscript of a LabShelf project."); }
  return opened;
}

/** Links the source to a folder here; a folder of another repository is kept only when the user says so. True when linked. */
async function linkSource({ links, outputs }: ManuscriptOutputs, source: string): Promise<boolean> {
  const { folder, mismatch } = await links.linkSource(source);
  if (folder === undefined) { return false; }
  if (!mismatch) { return true; }
  const anyway = "Link Anyway";
  const answer = await vscode.window.showWarningMessage("Link anyway?", {
    modal: true, detail: `${source} was linked from ${mismatch.expected}, but this folder's repository is ${mismatch.actual}.`,
  }, anyway);
  if (answer === anyway) { return true; }
  await outputs.sources.unlink(source);
  return false;
}

async function runSource(deps: NativeOutputDeps, uri: vscode.Uri, source: string): Promise<void> {
  const opened = outputsOf(deps, uri);
  if (!opened) { return; }
  try {
    const { updated, result } = await opened.links.run(source, new AbortController().signal);
    const message = describeOutputRun(updated, result);
    if (message) { void vscode.window.showInformationMessage(message); }
  } catch (error) {
    const show = "Show Output";
    void vscode.window.showErrorMessage(formatError(error), show).then((answer) => { if (answer === show) { deps.sources.showOutput?.(); } });
  }
}

async function sourceSettings(opened: ManuscriptOutputs, source: string): Promise<void> {
  const here = await opened.outputs.sources.status(source);
  const shared = (await opened.links.read()).file.sources[source]?.run;
  const items: Array<vscode.QuickPickItem & { id: "folder" | "command" | "unlink" }> = [
    { id: "folder", label: here ? "Change Folder…" : "Link to Code…", ...(here ? { description: here.folder } : {}) },
    ...(here ? [
      { id: "command" as const, label: "Set Command for This Computer…", description: here.command ?? shared ?? "no command" },
      { id: "unlink" as const, label: "Unlink from This Computer", detail: "The copies stay in the project." },
    ] : []),
  ];
  const picked = await vscode.window.showQuickPick(items, { title: `Source ${source}` });
  if (picked?.id === "folder") { await linkSource(opened, source); }
  if (picked?.id === "unlink") { await opened.outputs.sources.unlink(source); }
  if (picked?.id === "command") {
    const command = await vscode.window.showInputBox({
      title: `Command of ${source} on this computer`, value: here?.command ?? shared ?? "", prompt: "Runs in the source folder. Leave empty to use the project's command.",
    });
    if (command !== undefined) { await opened.outputs.sources.setCommand(source, command.trim() || undefined); }
  }
}

// ---- Link Output… in the native editor

/** The source to link from, linked here: an existing one (linked now if needed) or a new one. Undefined when cancelled. */
async function pickSource(opened: ManuscriptOutputs): Promise<string | undefined> {
  const { file } = await opened.links.read();
  const names = Object.keys(file.sources).sort((a, b) => a.localeCompare(b));
  const items = await Promise.all(names.map(async (name) => {
    const here = await opened.outputs.sources.status(name).catch(() => undefined);
    return { label: name, description: here?.folder ?? "not linked on this computer", name };
  }));
  const picked = await vscode.window.showQuickPick([...items, { label: "$(add) New Source…", description: "a folder of code that writes outputs", name: undefined }], { title: "Link Output: Source" });
  if (!picked) { return undefined; }
  if (picked.name !== undefined) {
    if (await opened.outputs.sources.status(picked.name)) { return picked.name; }
    return await linkSource(opened, picked.name) ? picked.name : undefined;
  }
  const name = await vscode.window.showInputBox({
    title: "Link Output: Source Name", prompt: "A short name for the code's folder, e.g. experiments",
    validateInput: (value) => !isOutputSourceName(value.trim()) ? "Start with a letter; up to 40 letters, digits, '-' or '_'." : file.sources[value.trim()] ? "There is already a source with this name." : undefined,
  });
  if (name === undefined) { return undefined; }
  const command = await vscode.window.showInputBox({ title: "Link Output: Command (optional)", prompt: "The command that writes the outputs, e.g. python run_all.py. Leave empty for none." });
  if (command === undefined) { return undefined; }
  const folder = await opened.links.addSource(name.trim(), command);
  return folder === undefined ? undefined : name.trim();
}

/** The kind and its options of a picked file; undefined when cancelled. */
async function pickKind(opened: ManuscriptOutputs, source: string, path: string): Promise<Pick<OutputCreateInput, "kind" | "decimals" | "keys"> | undefined> {
  const choices = deriveOutputKindChoices(path);
  // A QuickPickItem's own `kind` is its separator flag, so the output kind travels as `value`.
  const items = choices.map((each) => ({ label: OUTPUT_KIND_LABELS[each], value: each }));
  const kind: OutputKind | undefined = choices.length === 1 ? choices[0] : (await vscode.window.showQuickPick(items, { title: `Link Output: ${path} as` }))?.value;
  if (kind === "values") {
    const bytes = await opened.outputs.sources.read(source, path);
    let keys: string[] = [];
    try { keys = bytes ? listOutputValueKeys(JSON.parse(new TextDecoder("utf-8").decode(bytes))) : []; } catch { keys = []; }
    if (keys.length === 0) { void vscode.window.showWarningMessage(`${path} has no values to link.`); return undefined; }
    const picked = await vscode.window.showQuickPick(keys.map((key) => ({ label: key })), { title: "Link Output: Values", canPickMany: true });
    return picked && picked.length > 0 ? { kind, keys: picked.map((each) => each.label) } : undefined;
  }
  if (kind === "table") {
    const typed = await vscode.window.showInputBox({
      title: "Link Output: Decimals (optional)", prompt: "Round the table's numbers to this many decimals. Leave empty to keep them as written.",
      validateInput: (value) => { const parsed = parseDecimalsInput(value); return "error" in parsed ? parsed.error : undefined; },
    });
    if (typed === undefined) { return undefined; }
    const parsed = parseDecimalsInput(typed);
    return "error" in parsed ? undefined : { kind, ...(parsed.decimals !== undefined ? { decimals: parsed.decimals } : {}) };
  }
  return kind && { kind };
}

async function linkOutputNative(deps: NativeOutputDeps, editor: vscode.TextEditor): Promise<void> {
  const opened = outputsOf(deps, editor.document.uri);
  if (!opened) { return; }
  const source = await pickSource(opened);
  if (source === undefined) { return; }
  const files = filterLinkableOutputs(await opened.outputs.sources.list(source));
  if (files.length === 0) { void vscode.window.showInformationMessage(`${source} has no figures, tables or values to link yet. Run its code first.`); return; }
  const path = (await vscode.window.showQuickPick(files, { title: "Link Output: File" }));
  if (path === undefined) { return; }
  const options = await pickKind(opened, source, path);
  if (!options) { return; }
  const { link, insert } = await opened.links.create({ source, path, ...options, manuscriptPath: opened.manuscriptPath });
  if (insert.block) { await insertBlock(editor, insert.text); } else { await editor.edit((builder) => builder.replace(editor.selection, insert.text)); }
  await deps.logger.log("INFO", MODULE, "output linked", { project: opened.project.settings.id, kind: link.kind });
  if (link.kind === "table" && opened.project.settings.format === "latex" && !loadsBooktabs(editor.document.getText())) {
    void vscode.window.showInformationMessage("Add \\usepackage{booktabs} to the preamble.");
  }
}

async function linkOutput(deps: OutputCommandDeps): Promise<void> {
  // The LabShelf editor opens its own dialog, which inserts through the page.
  const view = deps.activeSource.current();
  if (view?.updates?.linkOutput) { view.updates.linkOutput(); return; }
  const editor = vscode.window.activeTextEditor;
  if (!editor || !readManuscriptLanguage(editor.document)) { void vscode.window.showInformationMessage("Open a LaTeX or Typst manuscript of a project to link an output."); return; }
  await linkOutputNative(deps, editor);
}

/** Runs a command and turns its failure into a logged error message. */
function guarded<A extends unknown[]>(deps: NativeOutputDeps, action: string, run: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
  return async (...args) => {
    try {
      await run(...args);
    } catch (error) {
      void deps.logger.error(MODULE, error, { action });
      void vscode.window.showErrorMessage(formatError(error));
    }
  };
}

/** Lenses follow every ready project's outputs: the outputs file, its copies and the linked source files. */
function watchProjects(deps: OutputCommandDeps, refresh: () => void): vscode.Disposable {
  let watches: vscode.Disposable[] = [];
  const rewatch = (): void => {
    for (const each of watches) { each.dispose(); }
    watches = deps.projects.list().flatMap((entry) => entry.kind !== "ready" ? [] : [
      openProjectOutputs(deps.sources, { folder: entry.folder, projectId: entry.settings.id }, deps.projects.fs, deps.projects.paths.join).watch(refresh),
    ]);
    refresh();
  };
  rewatch();
  const subscription = deps.projects.onDidChange(rewatch);
  return { dispose: () => { subscription.dispose(); for (const each of watches) { each.dispose(); } } };
}

/** Registers Link Output…, the hidden commands of the hover and the lenses, and the hover and lenses on .tex and .typ files. */
export function registerOutputLinks(context: vscode.ExtensionContext, deps: OutputCommandDeps): void {
  // PLATFORM: the commands exist only where a source folder can be read (desktop); the palette entry follows this key.
  void vscode.commands.executeCommand("setContext", OUTPUTS_AVAILABLE_KEY, true);
  const lenses = createOutputLensProvider(deps);
  const selector = [{ scheme: "file", pattern: "**/*.tex" }, { scheme: "file", pattern: "**/*.typ" }];
  const refreshAfter = <A extends unknown[]>(run: (...args: A) => Promise<void>) => async (...args: A): Promise<void> => { await run(...args); lenses.refresh(); };
  context.subscriptions.push(
    lenses,
    vscode.languages.registerCodeLensProvider(selector, lenses),
    vscode.languages.registerHoverProvider(selector, createOutputHoverProvider(deps)),
    watchProjects(deps, () => lenses.refresh()),
    deps.sources.onDidChange(() => lenses.refresh()),
    vscode.commands.registerCommand(LINK_OUTPUT_COMMAND, guarded(deps, "linkOutput", refreshAfter(() => linkOutput(deps)))),
    vscode.commands.registerCommand(OUTPUT_COMMANDS.run, guarded(deps, "runOutputSource", refreshAfter((uri: vscode.Uri | string, source: string) => runSource(deps, toUri(uri), source)))),
    vscode.commands.registerCommand(OUTPUT_COMMANDS.update, guarded(deps, "updateOutput", refreshAfter(async (uri: vscode.Uri | string, linkId: string) => {
      await outputsOf(deps, toUri(uri))?.links.update(linkId);
    }))),
    vscode.commands.registerCommand(OUTPUT_COMMANDS.link, guarded(deps, "linkOutputSource", refreshAfter(async (uri: vscode.Uri | string, source: string) => {
      const opened = outputsOf(deps, toUri(uri));
      if (opened) { await linkSource(opened, source); }
    }))),
    vscode.commands.registerCommand(OUTPUT_COMMANDS.settings, guarded(deps, "outputSourceSettings", refreshAfter(async (uri: vscode.Uri | string, source: string) => {
      const opened = outputsOf(deps, toUri(uri));
      if (opened) { await sourceSettings(opened, source); }
    }))),
  );
}
