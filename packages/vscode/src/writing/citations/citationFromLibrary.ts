// Registers Cite from Library, which inserts a citation of a picked paper, and optionally one of its highlights, at every cursor.
import * as vscode from "vscode";

import {
  deriveChoiceCitationSpec,
  createCitationSnippet,
  listQuotableHighlights,
  type HighlightChoice,
  type PaperRecord,
  type ProjectFormat,
  CITE_WITHOUT_PAGE,
  formatHighlightLabel,
  formatHighlightPage,
  type Annotation,
} from "@labshelf/core";
import { createPaperPickItem } from "../../command/index.js";
import { UPDATE_BIBLIOGRAPHY_COMMAND } from "./citationCompletion.js";
import { findCitingProject, type CitationSession, type CitationWorkspace } from "./citationWorkspace.js";

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

async function citeFromLibrary(workspace: CitationWorkspace): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const session = workspace.session();
  // The project's source extension stands in for the language id: Typst has no built-in one.
  const project = editor && findCitingProject(workspace.projects, editor.document.uri.fsPath);
  if (!editor || !session || !project) { return; }
  const paper = await pickPaper(session);
  if (!paper) { return; }
  const choice = await pickHighlight(session, paper);
  if (!choice) { return; }
  if (await insertCitation(editor, session, project.settings.format, paper, choice)) {
    // The paper's BibTeX entry reaches labshelf.bib through the bibliography sync.
    await vscode.commands.executeCommand(UPDATE_BIBLIOGRAPHY_COMMAND, editor.document.uri);
  }
}

export function registerCitationFromLibrary(context: vscode.ExtensionContext, workspace: CitationWorkspace): void {
  context.subscriptions.push(vscode.commands.registerCommand(CITE_FROM_LIBRARY_COMMAND, () => citeFromLibrary(workspace)));
}
