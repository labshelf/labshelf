// Gives the editor a project's JSON values, the files listed under `values:` and the linked values outputs: the per-project leaves cache, `\lsvalue` and Typst json() completion and hover, and the path resolution between them.
import * as vscode from "vscode";

import {
  OUTPUTS_FILE_PATH,
  OUTPUTS_FOLDER,
  deriveProjectValueFilePath,
  deriveProjectValueMembers,
  findLatexProjectValue,
  findLatexProjectValueStart,
  findTypstProjectValue,
  findTypstProjectValuePrefix,
  type ILogger,
  type PathOps,
  type ProjectValueLeaf,
} from "@labshelf/core";
import { disposeAll } from "../../disposables/index.js";
import { findOwningProject, type ReadyProject } from "./commands.js";
import type { WritingProjects } from "./session.js";

/**
 * The value file a `json("…")` path in a .typ file reads, relative to the project folder: one `values:` lists or the copy of a linked
 * values output (a file some leaf comes from); undefined for any other file.
 */
function findProjectValueFile(path: PathOps, project: ReadyProject, typFile: string, source: string, leaves: readonly ProjectValueLeaf[]): string | undefined {
  // PLATFORM: Typst resolves a path from the .typ file's folder, and a leading `/` from the project root.
  const absolute = source.startsWith("/") ? path.join(project.folder, source) : path.resolve(path.dirname(typFile), source);
  const relative = deriveProjectValueFilePath(path.relative(project.folder, absolute));
  const listed = project.settings.values?.some((each) => deriveProjectValueFilePath(each) === relative) ?? false;
  return listed || leaves.some((leaf) => leaf.file === relative) ? relative : undefined;
}


/** What the providers read per request: the project list and the open library's logger. */
export interface ProjectValueWorkspace {
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "onDidChange">;
  logger(): ILogger | undefined;
}

const SOURCE_EXTENSION = { latex: ".tex", typst: ".typ" } as const;

export class ProjectValues implements vscode.Disposable {
  private readonly cache = new Map<string, Promise<ProjectValueLeaf[]>>();
  private watchers: vscode.Disposable[] = [];
  private readonly subscription: vscode.Disposable;

  constructor(private readonly workspace: ProjectValueWorkspace) {
    this.watch();
    this.subscription = workspace.projects.onDidChange(() => {
      this.cache.clear();
      this.watch();
    });
  }

  /** The path style of the project folders. */
  get paths(): PathOps {
    return this.workspace.projects.paths;
  }

  /** The ready project that owns the file as a source of its format; its values may come from `values:` or from linked outputs, so an empty list is no reason to skip it. */
  sourceProject(file: string): ReadyProject | undefined {
    const project = findOwningProject(this.workspace.projects, file);
    return project && this.paths.extname(file) === SOURCE_EXTENSION[project.settings.format] ? project : undefined;
  }

  leaves(project: ReadyProject): Promise<ProjectValueLeaf[]> {
    if (!this.workspace.logger()) { return Promise.resolve([]); }
    const cached = this.cache.get(project.folder);
    if (cached) { return cached; }
    const read = this.workspace.projects.data.readProjectValues(project);
    this.cache.set(project.folder, read);
    return read;
  }

  dispose(): void {
    this.subscription.dispose();
    disposeAll(this.watchers);
    this.watchers = [];
  }

  private watch(): void {
    disposeAll(this.watchers);
    this.watchers = [];
    for (const entry of this.workspace.projects.list()) {
      if (entry.kind !== "ready") { continue; }
      const drop = (): void => { this.cache.delete(entry.folder); };
      const patterns = [
        ...(entry.settings.values ?? []).map((listed) => {
          const file = this.paths.resolve(entry.folder, listed);
          return new vscode.RelativePattern(this.paths.dirname(file), this.paths.basename(file));
        }),
        // The linked values outputs: which copies there are, and the copies themselves.
        new vscode.RelativePattern(entry.folder, `{${OUTPUTS_FILE_PATH},${OUTPUTS_FOLDER}/**/*.json}`),
      ];
      for (const pattern of patterns) {
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        this.watchers.push(watcher, watcher.onDidCreate(drop), watcher.onDidChange(drop), watcher.onDidDelete(drop));
      }
    }
  }
}


function item(label: string, leaf: ProjectValueLeaf | undefined, file: string, range: vscode.Range): vscode.CompletionItem {
  const completion = new vscode.CompletionItem(label, leaf ? vscode.CompletionItemKind.Value : vscode.CompletionItemKind.Field);
  if (leaf) { completion.detail = String(leaf.value); }
  completion.documentation = file;
  completion.insertText = label;
  completion.range = range;
  return completion;
}

export class ProjectValueCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly values: ProjectValues) {}

  async provideCompletionItems(
    document: vscode.TextDocument, position: vscode.Position,
  ): Promise<vscode.CompletionItem[] | undefined> {
    const project = this.values.sourceProject(document.uri.fsPath);
    if (!project) { return undefined; }
    return project.settings.format === "latex"
      ? this.latexKeys(project, document, position)
      : this.typstMembers(project, document, position);
  }

  private async latexKeys(project: ReadyProject, document: vscode.TextDocument, position: vscode.Position) {
    const start = findLatexProjectValueStart(document.lineAt(position.line).text.slice(0, position.character));
    if (start === undefined) { return undefined; }
    const range = new vscode.Range(position.line, start, position.line, position.character);
    const leaves = await this.values.leaves(project);
    // A project with no value files and no linked values has nothing to offer.
    if (leaves.length === 0) { return undefined; }
    return leaves.map((leaf) => item(leaf.key, leaf, leaf.file, range));
  }

  private async typstMembers(project: ReadyProject, document: vscode.TextDocument, position: vscode.Position) {
    const typing = findTypstProjectValuePrefix(document.getText(), document.offsetAt(position));
    if (!typing) { return undefined; }
    const leaves = await this.values.leaves(project);
    const file = findProjectValueFile(this.values.paths, project, document.uri.fsPath, typing.source, leaves);
    if (file === undefined) { return undefined; }
    const range = new vscode.Range(document.positionAt(typing.start), position);
    return deriveProjectValueMembers(leaves, file, typing.parent).map((member) => item(member.name, member.leaf, file, range));
  }
}

function leafHover(leaf: ProjectValueLeaf): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString();
  markdown.appendText(String(leaf.value));
  markdown.appendMarkdown("\n\n");
  markdown.appendText(`${leaf.file} → ${leaf.path}`);
  return markdown;
}

function unknownHover(name: string): vscode.MarkdownString {
  return new vscode.MarkdownString().appendText(`No value "${name}" in the files listed under values in labshelf.yaml or in the project's linked outputs.`);
}

export class ProjectValueHoverProvider implements vscode.HoverProvider {
  constructor(private readonly values: ProjectValues) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    const project = this.values.sourceProject(document.uri.fsPath);
    if (!project) { return undefined; }
    const offset = document.offsetAt(position);
    const leaves = await this.values.leaves(project);
    const found = project.settings.format === "latex"
      ? this.latex(document, offset, leaves)
      : this.typst(project, document, offset, leaves);
    return found && new vscode.Hover(found.contents, new vscode.Range(document.positionAt(found.start), document.positionAt(found.end)));
  }

  private latex(document: vscode.TextDocument, offset: number, leaves: readonly ProjectValueLeaf[]) {
    const reference = findLatexProjectValue(document.getText(), offset);
    if (!reference || leaves.length === 0) { return undefined; }
    const leaf = leaves.find((candidate) => candidate.key === reference.key);
    return { ...reference, contents: leaf ? leafHover(leaf) : unknownHover(reference.key) };
  }

  private typst(project: ReadyProject, document: vscode.TextDocument, offset: number, leaves: readonly ProjectValueLeaf[]) {
    const reference = findTypstProjectValue(document.getText(), offset);
    const file = reference && findProjectValueFile(this.values.paths, project, document.uri.fsPath, reference.source, leaves);
    if (!reference || file === undefined) { return undefined; }
    const leaf = leaves.find((candidate) => candidate.file === file && candidate.path === reference.path);
    // A member that holds more members has no single value to show.
    if (!leaf && leaves.some((candidate) => candidate.file === file && candidate.path.startsWith(`${reference.path}.`))) { return undefined; }
    return { ...reference, contents: leaf ? leafHover(leaf) : unknownHover(reference.path) };
  }
}

// Typst has no built-in language id, so sources are matched by file name.
const SOURCES = [
  { selector: { scheme: "file", pattern: "**/*.tex" }, triggers: ["{", "."] },
  { selector: { scheme: "file", pattern: "**/*.typ" }, triggers: ["."] },
];

export function registerProjectValues(context: vscode.ExtensionContext, workspace: ProjectValueWorkspace): void {
  const values = new ProjectValues(workspace);
  const completion = new ProjectValueCompletionProvider(values);
  const hover = new ProjectValueHoverProvider(values);
  context.subscriptions.push(values);
  for (const { selector, triggers } of SOURCES) {
    context.subscriptions.push(
      vscode.languages.registerCompletionItemProvider(selector, completion, ...triggers),
      vscode.languages.registerHoverProvider(selector, hover),
    );
  }
}
