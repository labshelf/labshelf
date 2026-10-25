// Registers citation completion, hover, links, bibliography updates and Cite from Library for LaTeX and Typst sources.
import * as vscode from "vscode";

import { CitationCompletionProvider, UPDATE_BIBLIOGRAPHY_COMMAND } from "./citationCompletion.js";
import { CitationHoverProvider } from "./hover/index.js";
import { type CitationWorkspace, findCitingProject } from "./citationWorkspace.js";
import { registerCitationFromLibrary } from "./citationFromLibrary.js";
import { formatError, DEFAULT_BIBLIOGRAPHY, findCiteKeyOccurrences } from "@labshelf/core";
import { openEditorSources } from "./openEditorSources.js";
import type { ReadyProject } from "../buildRootDocument.js";

// A definition provider must answer with a source Location, so the paper opens through a document link.
export class CitationLinkProvider implements vscode.DocumentLinkProvider {
  constructor(private readonly workspace: CitationWorkspace) {}

  async provideDocumentLinks(document: vscode.TextDocument): Promise<vscode.DocumentLink[]> {
    const project = findCitingProject(this.workspace.projects, document.uri.fsPath);
    const session = this.workspace.session();
    if (!project || !session) { return []; }
    const papers = new Map((await session.listPapers()).map((paper) => [paper.citeKey, paper]));
    return findCiteKeyOccurrences(project.settings.format, document.getText()).flatMap((cited) => {
      const paper = papers.get(cited.key);
      if (!paper) { return []; }
      const range = new vscode.Range(document.positionAt(cited.start), document.positionAt(cited.end));
      const link = new vscode.DocumentLink(range, vscode.Uri.parse(`command:labshelf.openPdfViewer?${encodeURIComponent(JSON.stringify([paper.id]))}`));
      link.tooltip = "Open in LabShelf reader";
      return [link];
    });
  }
}

class BibliographySync {
  private queue: Promise<void> = Promise.resolve();
  private readonly warned = new Set<string>();

  constructor(private readonly workspace: CitationWorkspace) {}

  /** Updates the bibliography of the project owning the file; a file outside a ready project is ignored. */
  update(file: string): Promise<void> {
    const project = findCitingProject(this.workspace.projects, file);
    const session = this.workspace.session();
    if (!project || !session) { return Promise.resolve(); }
    // Runs one update at a time: two concurrent ones could both add the bibliography line to the main file.
    this.queue = this.queue.then(() => this.run(project, session));
    return this.queue;
  }

  private async run(project: ReadyProject, session: NonNullable<ReturnType<CitationWorkspace["session"]>>): Promise<void> {
    try {
      const result = await this.workspace.projects.data.updateProjectBibliography(project, await session.listPapers(), openEditorSources);
      if (result.mainLine === "conflict") { this.warnConflict(project); }
      // labshelf.yaml gained `bibliography` once the project first cited a library paper, or its papers list changed.
      const recordedBibliography = result.mainLine !== "not-needed" && project.settings.bibliography === undefined;
      if (recordedBibliography || result.papersWritten) {
        await this.workspace.projects.reload();
      }
    } catch (error) {
      await session.logger.error("writing/citations", error, { folder: project.folder, action: "update-bibliography" });
      void vscode.window.showWarningMessage(
        `Could not update the bibliography of ${project.settings.id}: ${formatError(error)}`,
      );
    }
  }

  private warnConflict(project: ReadyProject): void {
    if (this.warned.has(project.folder)) { return; }
    this.warned.add(project.folder);
    void vscode.window.showWarningMessage(
      `The main file of ${project.settings.id} already loads another bibliography. `
      + `Add "${project.settings.bibliography ?? DEFAULT_BIBLIOGRAPHY}" to it to cite library papers.`,
    );
  }
}

// Typst has no built-in language id, so sources are matched by file name.
const SOURCES = [
  { selector: { scheme: "file", pattern: "**/*.tex" }, triggers: ["{", ",", "["] },
  { selector: { scheme: "file", pattern: "**/*.typ" }, triggers: ["@", "<", "["] },
];

export function registerCitationProviders(
  context: vscode.ExtensionContext,
  workspace: CitationWorkspace,
): void {
  const sync = new BibliographySync(workspace);
  const completion = new CitationCompletionProvider(workspace);
  const hover = new CitationHoverProvider(workspace);
  const links = new CitationLinkProvider(workspace);
  for (const { selector, triggers } of SOURCES) {
    context.subscriptions.push(
      vscode.languages.registerCompletionItemProvider(selector, completion, ...triggers),
      vscode.languages.registerHoverProvider(selector, hover),
      vscode.languages.registerDocumentLinkProvider(selector, links),
    );
  }
  context.subscriptions.push(
    vscode.commands.registerCommand(UPDATE_BIBLIOGRAPHY_COMMAND, (uri: vscode.Uri) => sync.update(uri.fsPath)),
    vscode.workspace.onDidSaveTextDocument((document) => void sync.update(document.uri.fsPath)),
  );
  registerCitationFromLibrary(context, workspace);
}
