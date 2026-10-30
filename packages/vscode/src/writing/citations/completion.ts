// Completes and inserts citations: the cite-key and page-argument completion, Cite from Library, and the provider registration with its bibliography sync.
import * as vscode from "vscode";

import {
  CITE_WITHOUT_PAGE,
  DEFAULT_BIBLIOGRAPHY,
  createCitationSnippet,
  deriveChoiceCitationSpec,
  derivePageArgument,
  derivePageSupplement,
  derivePapersByCiteKey,
  deriveQuotationBefore,
  findCiteKeyOccurrences,
  findPartialCiteKeyStart,
  formatError,
  formatHighlightLabel,
  formatHighlightPage,
  listQuotableHighlights,
  type Annotation,
  type HighlightChoice,
  type PageArgumentContext,
  type PaperRecord,
  type ProjectFormat,
} from "@labshelf/core";
import { createPaperPickItem } from "../../command/index.js";
import type { ActiveSource } from "../activeSource.js";
import type { ReadyProject } from "../projects/index.js";
import { findCitingProject, openEditorSources, type CitationSession, type CitationWorkspace } from "./backlinks.js";
import { CitationHoverProvider } from "./hover.js";

const LABEL_TEXT_LENGTH = 60;

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > LABEL_TEXT_LENGTH ? `${flat.slice(0, LABEL_TEXT_LENGTH).trimEnd()}…` : flat;
}

// The key list is written with the page only when the command has none yet, so `\cite[|` ends as `\cite[p.~4]{key}`.
function insertion(
  format: ProjectFormat, context: PageArgumentContext, line: number, cursor: number, paper: PaperRecord, page: number,
): { range: vscode.Range; text: string } {
  const supplement = derivePageSupplement(format, page);
  if (context.hasKeys) {
    return { range: new vscode.Range(line, context.start, line, context.close ?? cursor), text: supplement };
  }
  const end = context.end ?? cursor;
  return { range: new vscode.Range(line, context.start, line, end), text: `${supplement}]{${paper.citeKey}}` };
}

interface HighlightItemsInput {
  format: ProjectFormat;
  context: PageArgumentContext;
  position: vscode.Position;
  paper: PaperRecord;
  highlights: readonly Annotation[];
}

/** Per highlight, an item inserting its page and one inserting the page plus the quotation before the citation. */
function highlightItems({ format, context, position, paper, highlights }: HighlightItemsInput): vscode.CompletionItem[] {
  const { line, character } = position;
  return highlights.flatMap((highlight, index) => {
    const { range, text } = insertion(format, context, line, character, paper, highlight.pageNumber);
    const quoteAt = new vscode.Position(line, context.commandStart);
    const quote = vscode.TextEdit.insert(quoteAt, deriveQuotationBefore(format, highlight.content));
    // Papers by key, highlights in page order, and the plain page ahead of its quotation.
    const order = `${paper.citeKey}${String(index).padStart(5, "0")}`;
    const item = (suffix: string, rank: string, edits: vscode.TextEdit[]): vscode.CompletionItem => {
      const entry = new vscode.CompletionItem(`p. ${highlight.pageNumber} — ${preview(highlight.content)}${suffix}`, vscode.CompletionItemKind.Value);
      entry.detail = `${paper.citeKey} — ${paper.title}`;
      entry.documentation = highlight.content;
      entry.filterText = `p. ${highlight.pageNumber} ${highlight.content} ${paper.citeKey}`;
      entry.sortText = order + rank;
      entry.insertText = text;
      entry.range = range;
      entry.additionalTextEdits = edits;
      return entry;
    };
    return [item("", "a", []), item(" · quote", "b", [quote])];
  });
}

async function highlightsOfPapers(
  session: CitationSession, papers: readonly PaperRecord[],
): Promise<Array<{ paper: PaperRecord; highlights: Annotation[] }>> {
  const loaded = await Promise.all(papers.map(async (paper) => {
    try {
      return { paper, highlights: listQuotableHighlights(await session.highlightsOf(paper.id)) };
    } catch (error) {
      void session.logger.log("WARN", "citations", "Highlights of a paper could not be read for completion", { paperId: paper.id, error: String(error) });
      return { paper, highlights: [] };
    }
  }));
  return loaded.filter(({ highlights }) => highlights.length > 0);
}

/**
 * The page-argument items at the cursor, or undefined when the cursor is not in a page argument.
 * An empty list means a page argument whose paper has no highlight text.
 */
async function findPageArgumentCompletion(
  format: ProjectFormat, session: CitationSession, document: vscode.TextDocument, position: vscode.Position,
): Promise<vscode.CompletionItem[] | undefined> {
  const text = document.lineAt(position.line).text;
  const context = derivePageArgument(format, text.slice(0, position.character), text.slice(position.character));
  if (!context) { return undefined; }
  const papers = await session.listPapers();
  const candidates = context.key === undefined ? papers : [derivePapersByCiteKey(papers).get(context.key)].filter((paper): paper is PaperRecord => paper !== undefined);
  const withHighlights = await highlightsOfPapers(session, candidates);
  return withHighlights.flatMap(({ paper, highlights }) => highlightItems({ format, context, position, paper, highlights }));
}

export const UPDATE_BIBLIOGRAPHY_COMMAND = "labshelf.citations.updateBibliography";

const updateBibliography = (document: vscode.TextDocument): vscode.Command =>
  ({ command: UPDATE_BIBLIOGRAPHY_COMMAND, title: "Update bibliography", arguments: [document.uri] });

function citationItem(paper: PaperRecord, range: vscode.Range, document: vscode.TextDocument): vscode.CompletionItem {
  const authors = paper.authors?.join(", ");
  const item = new vscode.CompletionItem(
    { label: paper.citeKey, ...(paper.year === undefined ? {} : { description: String(paper.year) }) },
    vscode.CompletionItemKind.Reference,
  );
  item.detail = paper.title;
  item.documentation = [authors, paper.year].filter((part) => part !== undefined && part !== "").join(" ");
  item.filterText = [paper.citeKey, paper.title, authors].filter(Boolean).join(" ");
  // "0" ranks library papers ahead of keys other providers complete from a .bib file.
  item.sortText = `0${paper.citeKey}`;
  item.insertText = paper.citeKey;
  item.range = range;
  item.command = updateBibliography(document);
  return item;
}

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
    const prefix = document.lineAt(position.line).text.slice(0, position.character);
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
  activeSource: Pick<ActiveSource, "current">,
): void {
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
    vscode.workspace.onDidSaveTextDocument((document) => void sync.update(document.uri.fsPath)),
  );
  registerCitationFromLibrary(context, workspace, activeSource);
}
