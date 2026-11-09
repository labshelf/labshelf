// The VS Code "Cite in a project…" of the reader: picks a project and an action, then cites the paper in the project's open source file, copies the citation, or adds the paper to labshelf.bib.
import * as vscode from "vscode";

import {
  PROJECT_FILE, createReaderCitation, deriveReaderCiteChoices, isInProjectBibliography, withListedPaper,
  type CitationInProjectRequest, type PaperRecord, type ReaderCiteChoice, type ReadyProject,
} from "@labshelf/core";
import { UPDATE_BIBLIOGRAPHY_COMMAND } from "../writing/citations/completionItems.js";
import type { ActiveSource, SourceView } from "../writing/activeSource.js";
import type { WritingProjects } from "../writing/projects/index.js";

export interface ReaderCiteDeps {
  projects: Pick<WritingProjects, "list" | "paths" | "reload"> & { data: Pick<WritingProjects["data"], "updateProjectSettings"> };
  activeSource: Pick<ActiveSource, "current" | "listOpen">;
}

/** A source file of the project the citation can go into. */
interface OpenSource {
  uri: vscode.Uri;
  insert(text: string): Promise<boolean>;
}

const SOURCE_FILE = /\.(tex|typ)$/;

const inFolder = (uri: vscode.Uri, folder: string, sep: string): boolean => uri.fsPath.startsWith(folder.endsWith(sep) ? folder : folder + sep);

function nativeSource(editor: vscode.TextEditor): OpenSource {
  return {
    uri: editor.document.uri,
    insert: async (text) => {
      const applied = await editor.edit((edit) => { for (const selection of editor.selections) { edit.replace(selection, text); } });
      if (applied) { await vscode.window.showTextDocument(editor.document, editor.viewColumn); }
      return applied;
    },
  };
}

function labshelfSource(view: SourceView & { updates: NonNullable<SourceView["updates"]> }): OpenSource {
  return { uri: view.uri, insert: async (text) => { view.updates.insertText(text); return true; } };
}

/** The editor the citation goes into: the last focused source when it is the project's, else an open LabShelf editor, else a visible text editor. */
function findOpenSource(deps: ReaderCiteDeps, project: ReadyProject): OpenSource | undefined {
  const sep = deps.projects.paths.sep;
  const mine = (uri: vscode.Uri): boolean => inFolder(uri, project.folder, sep) && SOURCE_FILE.test(uri.fsPath);
  const asSource = (view: SourceView | undefined): OpenSource | undefined => {
    if (!view || !mine(view.uri)) { return undefined; }
    if (view.updates) { return labshelfSource({ ...view, updates: view.updates }); }
    const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.toString() === view.uri.toString());
    return editor && nativeSource(editor);
  };
  const native = vscode.window.visibleTextEditors.find((editor) => mine(editor.document.uri));
  return asSource(deps.activeSource.current())
    ?? deps.activeSource.listOpen().map(asSource).find((source) => source !== undefined)
    ?? (native && nativeSource(native));
}

function readyProjects(deps: ReaderCiteDeps): ReadyProject[] {
  return deps.projects.list().filter((entry): entry is ReadyProject => entry.kind === "ready");
}

/** The project's labshelf.yaml as last read, so the paper is added to its current list. */
function latest(deps: ReaderCiteDeps, project: ReadyProject): ReadyProject {
  return readyProjects(deps).find((entry) => entry.folder === project.folder) ?? project;
}

/** Lists the paper in the project's `papers` and regenerates labshelf.bib; false when the user had already listed it. */
async function addToBibliography(deps: ReaderCiteDeps, chosen: ReadyProject, paper: PaperRecord): Promise<boolean> {
  const project = latest(deps, chosen);
  const papers = withListedPaper(project.settings.papers ?? [], paper);
  if (!papers) { return false; }
  await deps.projects.data.updateProjectSettings(project.folder, { papers });
  await deps.projects.reload();
  await vscode.commands.executeCommand(UPDATE_BIBLIOGRAPHY_COMMAND, vscode.Uri.file(deps.projects.paths.join(project.folder, PROJECT_FILE)));
  return true;
}

type ProjectItem = vscode.QuickPickItem & { project: ReadyProject };
type ChoiceItem = vscode.QuickPickItem & { choice: ReaderCiteChoice };

const FORMAT_NAMES = { latex: "LaTeX", typst: "Typst" } as const;

/** The source file name shown to the user, relative to the project folder. */
function sourceName(deps: ReaderCiteDeps, project: ReadyProject, source: OpenSource | undefined): string | undefined {
  return source && deps.projects.paths.relative(project.folder, source.uri.fsPath).split(deps.projects.paths.sep).join("/");
}

/** First step: the project, the one of the source the user last worked in first. Skipped when there is one project. */
async function pickProject(deps: ReaderCiteDeps, paper: PaperRecord, sources: Map<ReadyProject, OpenSource | undefined>): Promise<ReadyProject | undefined> {
  const projects = [...sources.keys()];
  if (projects.length === 1) { return projects[0]; }
  const current = deps.activeSource.current()?.uri;
  const isCurrent = (project: ReadyProject): number => Number(!!current && inFolder(current, project.folder, deps.projects.paths.sep));
  const items = projects.sort((a, b) => isCurrent(b) - isCurrent(a)).map((project): ProjectItem => {
    const name = sourceName(deps, project, sources.get(project));
    const listed = isInProjectBibliography(project.settings, paper);
    return {
      label: `$(folder) ${project.settings.title ?? project.settings.id}`,
      description: [FORMAT_NAMES[project.settings.format], name ? `${name} open` : undefined, listed ? "already in the bibliography" : undefined].filter(Boolean).join(" · "),
      project,
    };
  });
  return (await vscode.window.showQuickPick(items, { title: `Cite ${paper.title}`, placeHolder: "Which project?", matchOnDescription: true }))?.project;
}

/** Second step: what to do in the chosen project. */
async function pickChoice(
  deps: ReaderCiteDeps, project: ReadyProject, paper: PaperRecord, request: CitationInProjectRequest, source: OpenSource | undefined,
): Promise<ReaderCiteChoice | undefined> {
  const name = sourceName(deps, project, source);
  const items = deriveReaderCiteChoices({ format: project.settings.format, settings: project.settings }, paper, request, name).map((choice): ChoiceItem => ({
    label: `${choice.action === "bibliography" ? "$(book)" : name ? "$(quote)" : "$(copy)"} ${choice.label}`,
    description: choice.description,
    choice,
  }));
  const page = request.page === undefined ? "" : ` (p. ${request.page})`;
  const placeHolder = name ? `The citation goes where the cursor is in ${name}` : "No source of this project is open: copy the citation and paste it yourself";
  return (await vscode.window.showQuickPick(items, { title: `Cite ${paper.citeKey}${page} in ${project.settings.title ?? project.settings.id}`, placeHolder }))?.choice;
}

async function cite(deps: ReaderCiteDeps, paper: PaperRecord, request: CitationInProjectRequest): Promise<void> {
  const ready = readyProjects(deps);
  if (ready.length === 0) {
    void vscode.window.showInformationMessage("Open or create a LabShelf project first.");
    return;
  }
  const sources = new Map(ready.map((project) => [project, findOpenSource(deps, project)]));
  const project = await pickProject(deps, paper, sources);
  const choice = project && await pickChoice(deps, project, paper, request, sources.get(project));
  if (!project || !choice) { return; }
  const bibFile = project.settings.bibliography ?? "labshelf.bib";
  if (choice.action === "bibliography") {
    await addToBibliography(deps, project, paper);
    void vscode.window.showInformationMessage(`Added ${paper.citeKey} to ${bibFile} of ${project.settings.id}.`);
    return;
  }
  const text = createReaderCitation(project.settings.format, paper.citeKey, request, choice.action === "citeQuoted");
  const source = sources.get(project);
  if (source && await source.insert(text)) {
    // The citation reaches labshelf.bib through the bibliography sync, which reads the editor's unsaved text.
    await vscode.commands.executeCommand(UPDATE_BIBLIOGRAPHY_COMMAND, source.uri);
    return;
  }
  await vscode.env.clipboard.writeText(text);
  // Pasted later, the citation must already resolve, so the paper goes into labshelf.bib now.
  await addToBibliography(deps, project, paper);
  void vscode.window.showInformationMessage(`Copied ${text}. ${bibFile} of ${project.settings.id} has the paper.`);
}

export type ReaderCiteInProject = (paper: PaperRecord, request: CitationInProjectRequest) => Promise<void>;

/** The reader port: cites `paper` in a project the user picks. */
export function createCiteInProject(deps: ReaderCiteDeps): ReaderCiteInProject {
  // A failure reaches the reader host controller, which logs it and shows it as a notice.
  return (paper, request) => cite(deps, paper, request);
}
