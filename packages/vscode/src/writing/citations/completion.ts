// Completes and inserts citations: the cite-key and page-argument completion, Cite from Library, and the provider registration with its bibliography sync.
import * as vscode from "vscode";

import {
  CITE_WITHOUT_PAGE,
  createCitationSnippet,
  deriveChoiceCitationSpec,
  deriveCitedKeyContext,
  derivePapersByCiteKey,
  findCiteKeyOccurrences,
  findPartialCiteKeyStart,
  formatHighlightLabel,
  formatHighlightPage,
  listQuotableHighlights,
  type Annotation,
  type HighlightChoice,
  type PaperRecord,
  type ProjectFormat,
} from "@labshelf/core";
import { createPaperPickItem } from "../../command/index.js";
import type { ActiveSource } from "../activeSource.js";
import { findCitingProject, type CitationSession, type CitationWorkspace } from "./backlinks.js";
import { BibliographySync } from "./bibliographySync.js";
import {
  KEY_ACCEPTED_COMMAND, UPDATE_BIBLIOGRAPHY_COMMAND, citationItem, findPageArgumentCompletion, targetItems, targetsOfPaper, updateBibliography,
} from "./completionItems.js";
import { CitationHoverProvider } from "./hover.js";

export class CitationCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly workspace: CitationWorkspace) {}

  async provideCompletionItems(
    document: vscode.TextDocument, position: vscode.Position,
  ): Promise<vscode.CompletionItem[] | undefined> {
    const project = findCitingProject(this.workspace.projects, document.uri.fsPath);
    const session = this.workspace.session();
    if (!project || !session) { return undefined; }
    const pageItems = await findPageArgumentCompletion(project.settings.format, session, document, position);
    if (pageItems) {
      // A key written by a highlight pick is not in labshelf.bib yet.
      for (const item of pageItems) { item.command = updateBibliography(document); }
      return pageItems;
    }
    const line = document.lineAt(position.line).text;
    const prefix = line.slice(0, position.character);
    const cited = deriveCitedKeyContext(project.settings.format, prefix, line.slice(position.character));
    const citedPaper = cited && derivePapersByCiteKey(await session.listPapers()).get(cited.key);
    if (cited && citedPaper) {
      const targets = await targetsOfPaper(session, citedPaper);
      return targetItems(project.settings.format, cited, position, citedPaper, targets, document, line.slice(cited.commandStart, cited.commandEnd));
    }
    const start = findPartialCiteKeyStart(project.settings.format, prefix);
    if (start === undefined) { return undefined; }
    const range = new vscode.Range(position.line, start, position.line, position.character);
    return (await session.listPapers()).map((paper) => citationItem(paper, range, document));
  }
}

const QUOTE_BUTTON: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("quote"), tooltip: "Cite with quotation" };

interface HighlightPickItem extends vscode.QuickPickItem {
  highlight?: Annotation;
}

function pickItems(highlights: readonly Annotation[]): HighlightPickItem[] {
  return [
    { label: CITE_WITHOUT_PAGE },
    ...highlights.map((highlight) => ({
      label: formatHighlightLabel(highlight),
      description: formatHighlightPage(highlight),
      buttons: [QUOTE_BUTTON],
      highlight,
    })),
  ];
}

/** Resolves when the user accepts an item or clicks its quote button; undefined when the picker is dismissed. */
function chooseHighlight(highlights: readonly Annotation[]): Promise<HighlightChoice | undefined> {
  return new Promise((resolve) => {
    const picker = vscode.window.createQuickPick<HighlightPickItem>();
    let choice: HighlightChoice | undefined;
    const settle = (picked: HighlightChoice): void => {
      choice = picked;
      picker.hide();
    };
    picker.title = "Cite from Library";
    picker.placeholder = "Pick a highlight to cite its page";
    picker.matchOnDescription = true;
    picker.items = pickItems(highlights);
    picker.onDidAccept(() => {
      const [item] = picker.selectedItems;
      if (item) { settle({ ...(item.highlight ? { highlight: item.highlight } : {}), quote: false }); }
    });
    picker.onDidTriggerItemButton(({ item }) => settle({ ...(item.highlight ? { highlight: item.highlight } : {}), quote: true }));
    picker.onDidHide(() => {
      picker.dispose();
      resolve(choice);
    });
    picker.show();
  });
}

const CITE_FROM_LIBRARY_COMMAND = "labshelf.writing.citeFromLibrary";

async function pickPaper(session: CitationSession): Promise<PaperRecord | undefined> {
  const papers = await session.listPapers();
  if (papers.length === 0) {
    void vscode.window.showInformationMessage("LabShelf library is empty.");
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(papers.map(createPaperPickItem), {
    title: "Cite from Library", placeHolder: "Pick the paper to cite", matchOnDescription: true, matchOnDetail: true,
  });
  return picked?.paper;
}

/** A paper whose highlights cannot be read is still cited, without a page. */
async function pickHighlight(session: CitationSession, paper: PaperRecord): Promise<HighlightChoice | undefined> {
  let highlights;
  try {
    highlights = listQuotableHighlights(await session.highlightsOf(paper.id));
  } catch (error) {
    void session.logger.log("WARN", "citations", "Highlights of a paper could not be read; citing without a page", { paperId: paper.id, error: String(error) });
    return { quote: false };
  }
  return highlights.length === 0 ? { quote: false } : chooseHighlight(highlights);
}

async function insertCitation(
  editor: vscode.TextEditor, session: CitationSession, format: ProjectFormat, paper: PaperRecord, choice: HighlightChoice,
): Promise<boolean> {
  const text = createCitationSnippet(format, paper.citeKey, deriveChoiceCitationSpec(choice));
  const applied = await editor.edit((edit) => {
    for (const selection of editor.selections) { edit.replace(selection, text); }
  });
  if (!applied) {
    void session.logger.log("WARN", "citations", "The editor rejected the citation edit", { paperId: paper.id, uri: editor.document.uri.toString() });
  }
  return applied;
}

async function citeFromLibrary(workspace: CitationWorkspace, activeSource: Pick<ActiveSource, "current">): Promise<void> {
  const view = activeSource.current();
  // A LabShelf editor takes the citation through its page and the native editor is not touched.
  const labshelf = view?.updates ? { uri: view.uri, updates: view.updates } : undefined;
  const editor = labshelf ? undefined : vscode.window.activeTextEditor;
  const uri = labshelf?.uri ?? editor?.document.uri;
  const session = workspace.session();
  // The project's source extension stands in for the language id: Typst has no built-in one.
  const project = uri && findCitingProject(workspace.projects, uri.fsPath);
  if (!uri || !session || !project) { return; }
  const paper = await pickPaper(session);
  if (!paper) { return; }
  const choice = await pickHighlight(session, paper);
  if (!choice) { return; }
  let inserted: boolean;
  if (labshelf) {
    labshelf.updates.insertText(createCitationSnippet(project.settings.format, paper.citeKey, deriveChoiceCitationSpec(choice)));
    inserted = true;
  } else {
    inserted = await insertCitation(editor!, session, project.settings.format, paper, choice);
  }
  if (inserted) {
    // The paper's BibTeX entry reaches labshelf.bib through the bibliography sync.
    await vscode.commands.executeCommand(UPDATE_BIBLIOGRAPHY_COMMAND, uri);
  }
}

export function registerCitationFromLibrary(context: vscode.ExtensionContext, workspace: CitationWorkspace, activeSource: Pick<ActiveSource, "current">): void {
  context.subscriptions.push(vscode.commands.registerCommand(CITE_FROM_LIBRARY_COMMAND, () => citeFromLibrary(workspace, activeSource)));
}

// A definition provider must answer with a source Location, so the paper opens through a document link.
export class CitationProvider implements vscode.DocumentLinkProvider {
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

// Typst has no built-in language id, so sources are matched by file name.
const SOURCES = [
  { selector: { scheme: "file", pattern: "**/*.tex" }, triggers: ["{", ",", "["] },
  { selector: { scheme: "file", pattern: "**/*.typ" }, triggers: ["@", "<", "["] },
];

export function registerCitationProviders(
  context: vscode.ExtensionContext,
  workspace: CitationWorkspace,
  activeSource: Pick<ActiveSource, "current">,
): BibliographySync {
  const sync = new BibliographySync(workspace);
  const completion = new CitationCompletionProvider(workspace);
  const hover = new CitationHoverProvider(workspace);
  const links = new CitationProvider(workspace);
  for (const { selector, triggers } of SOURCES) {
    context.subscriptions.push(
      vscode.languages.registerCompletionItemProvider(selector, completion, ...triggers),
      vscode.languages.registerHoverProvider(selector, hover),
      vscode.languages.registerDocumentLinkProvider(selector, links),
    );
  }
  context.subscriptions.push(
    vscode.commands.registerCommand(UPDATE_BIBLIOGRAPHY_COMMAND, (uri: vscode.Uri) => sync.update(uri.fsPath)),
    vscode.commands.registerCommand(KEY_ACCEPTED_COMMAND, async (uri: vscode.Uri) => {
      await sync.update(uri.fsPath);
      await vscode.commands.executeCommand("editor.action.triggerSuggest");
    }),
    vscode.workspace.onDidSaveTextDocument((document) => void sync.update(document.uri.fsPath)),
  );
  registerCitationFromLibrary(context, workspace, activeSource);
  return sync;
}
