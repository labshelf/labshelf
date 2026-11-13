// The Cite from Library popup of the source editor, laid out as Insert code: pick a paper, see its pages with highlights
// and note pins, pick what the citation cites (a selected passage or highlight, a note, the page in view, or the whole
// paper), read the exact citation in the footer, Insert. Loaded on first use (libraryCitation.ts imports it lazily).
// It writes nothing itself (plan editor-cite-popup D3).
import type { Annotation, ItemFile, PaperRecord } from "../../../index.js";
import { mountCombobox, renderElement, renderPickerDialog, renderTextButton, showToast } from "../../../ui/dom/index.js";
import { createScopedCitation, findScopeNote, type CitationScope, type CitationScopeLookups } from "../../citations/citationScopes.js";
import { deriveNotePage } from "../../citations/citeTargets.js";
import type { LibraryCitationDeps } from "./libraryCitation.js";
import { mountPaperPages, type PaperNotePin, type PaperSelection } from "./paperPages.js";

/** What the popup reads: the papers, a paper's PDF, highlights and notes, and the project's format. */
export type CitePickSource = Pick<LibraryCitationDeps, "format" | "papers" | "pdfOf" | "annotationsOf" | "notesOf">;

/** The paper last picked, kept by the caller for its editor's life. */
export interface CitePickMemory { paperId?: string }

/** What Insert hands back: `text` is the exact citation, `quoted` whether the quotation goes before it. */
export interface CitePick { paper: PaperRecord; scope: CitationScope; quoted: boolean; text: string }

const HINT = "Select text, click a highlight or a note pin, or cite the page in view or the whole paper.";

/** The pins of the notes that have a page: a point or box at its place, a note on a highlight at the highlight's corner, others at the page's edge. */
function deriveNotePins(notes: ItemFile | undefined, annotations: readonly Annotation[]): PaperNotePin[] {
  return (notes?.segments ?? []).flatMap((segment): PaperNotePin[] => {
    if (segment.kind !== "item") return [];
    const page = deriveNotePage(segment, annotations);
    if (page === undefined) return [];
    const { anchor } = segment;
    if (anchor.kind === "point" || anchor.kind === "box") return [{ id: segment.id, page, x: anchor.x, y: anchor.y }];
    const position = anchor.kind === "highlight" ? annotations.find((annotation) => annotation.id === anchor.annotationId)?.position : undefined;
    return [position ? { id: segment.id, page, x: position.x, y: position.y } : { id: segment.id, page }];
  });
}

/** The quotation is offered for a scope with text: on by default for the author's words, off for the user's own note. */
const quotable = (scope: CitationScope): boolean => scope.kind === "highlight" || scope.kind === "passage" || scope.kind === "note";

function describeScope(scope: CitationScope): string {
  switch (scope.kind) {
    case "paper": return "Whole paper";
    case "page": return `Page ${scope.page}`;
    case "highlight": return `Highlight on p. ${scope.page}`;
    case "passage": return `Passage on p. ${scope.page}`;
    case "note": return scope.page === undefined ? "Note" : `Note on p. ${scope.page}`;
  }
}

const isModEnter = (event: KeyboardEvent): boolean => event.key === "Enter" && (event.metaKey || event.ctrlKey);

type PaperShown = { paper: PaperRecord; lookups: CitationScopeLookups; scope: CitationScope };

/** One open Cite from Library popup; `resolve` answers `pickLibraryCitation` once, when it closes. */
class CitePickPopup {
  private papers: readonly PaperRecord[] = [];
  private shown: PaperShown | undefined;
  private pages: { destroy(): void } | undefined;
  private pageInView: number | undefined;
  private done = false;
  private readSeq = 0;

  private readonly picker = mountCombobox({ label: "Paper", suggestions: [], placeholder: "Type to filter by title, @key or year", listAll: true, onPick: (picked) => void this.showPaper(picked.value) });
  private readonly preview = renderElement("code", { class: "ls-cite-pick-preview" });
  // The editor hosts load base.css, not the reader's sheet, so the buttons take its classes.
  private readonly copy = renderTextButton("Copy", "ls-btn");
  private readonly cancel = renderTextButton("Cancel", "ls-btn");
  private readonly insert = renderTextButton("Insert", "ls-btn ls-btn-primary");
  private readonly dialog = renderPickerDialog({
    heading: "Cite from Library", pickers: [{ label: "Paper", control: this.picker.root }], leading: [this.preview], trailing: [this.copy, this.cancel, this.insert], onDismiss: () => this.finish(undefined),
  });
  private readonly thisPage = renderTextButton("This page", "ls-btn");
  private readonly wholePaper = renderTextButton("Whole paper", "ls-btn");
  private readonly quoteBox = renderElement("input", { type: "checkbox" });
  private readonly quoteField = renderElement("label", { class: "rd-cite-dialog-check ls-cite-pick-quote" }, this.quoteBox, "With the quotation");
  private readonly what = renderElement("span", { class: "ls-cite-pick-what" });
  private readonly pagesBox = renderElement("div", { class: "ls-cite-pick-pages" });

  constructor(private readonly source: CitePickSource, private readonly memory: CitePickMemory, private readonly resolve: (pick: CitePick | undefined) => void) {
    this.insert.title = "Insert (Mod-Enter)";
    const scopes = renderElement("div", { class: "ls-cite-pick-scopes" }, this.thisPage, this.wholePaper, this.quoteField, this.what);
    this.dialog.body.classList.add("ls-cite-pick-body");
    this.dialog.body.append(scopes, this.pagesBox);
    this.wire();
    this.refresh();
    this.dialog.showStatus("Listing the library's papers…");
    void source.papers().then((listed) => this.onListed(listed), () => { if (!this.done) this.dialog.showStatus("Could not list the library's papers.", true); });
  }

  private wire(): void {
    this.thisPage.addEventListener("click", () => { if (this.pageInView !== undefined) this.choose({ kind: "page", page: this.pageInView }); });
    this.wholePaper.addEventListener("click", () => this.choose({ kind: "paper" }));
    this.quoteBox.addEventListener("change", () => this.refresh());
    this.copy.addEventListener("click", () => this.doCopy());
    this.cancel.addEventListener("click", () => { this.dialog.close(); this.finish(undefined); });
    this.insert.addEventListener("click", () => this.doInsert());
    this.dialog.content.addEventListener("keydown", (event) => {
      if (!isModEnter(event) || event.defaultPrevented) return;
      event.preventDefault();
      this.doInsert();
    });
  }

  private finish(pick: CitePick | undefined): void {
    if (this.done) return;
    this.done = true;
    this.pages?.destroy();
    this.resolve(pick);
  }

  private pick(): CitePick | undefined {
    if (!this.shown) return undefined;
    const { paper, scope, lookups } = this.shown;
    const quoted = quotable(scope) && this.quoteBox.checked;
    return { paper, scope, quoted, text: createScopedCitation(this.source.format, paper.citeKey, scope, quoted, lookups) };
  }

  private refresh(): void {
    const chosen = this.pick();
    const { pageInView } = this;
    this.preview.textContent = chosen?.text ?? "";
    this.insert.disabled = this.copy.disabled = this.wholePaper.disabled = chosen === undefined;
    this.thisPage.disabled = chosen === undefined || pageInView === undefined;
    this.thisPage.textContent = pageInView === undefined ? "This page" : `This page (p. ${pageInView})`;
    this.quoteField.hidden = !chosen || !quotable(chosen.scope);
    this.what.textContent = chosen ? describeScope(chosen.scope) : "";
    this.wholePaper.setAttribute("aria-pressed", String(chosen?.scope.kind === "paper"));
    this.thisPage.setAttribute("aria-pressed", String(chosen?.scope.kind === "page"));
  }

  /** A new pick replaces the one before; the quotation starts on for the author's words, off for a note. */
  private choose(scope: CitationScope | undefined): void {
    if (!this.shown || !scope) return;
    this.shown.scope = scope;
    this.quoteBox.checked = scope.kind === "highlight" || scope.kind === "passage";
    this.refresh();
  }

  // A highlight or note scope keeps its page as read now, so the command without the quotation is known from the scope alone.
  private highlightScope(id: string): CitationScope | undefined {
    const highlight = this.shown?.lookups.annotations.find((annotation) => annotation.id === id);
    return highlight && { kind: "highlight", annotationId: id, page: highlight.pageNumber };
  }

  private noteScope(id: string): CitationScope | undefined {
    const { shown } = this;
    const note = shown && findScopeNote(shown.lookups.notes, id);
    if (!shown || !note) return undefined;
    const page = deriveNotePage(note, shown.lookups.annotations);
    return page === undefined ? { kind: "note", noteId: id } : { kind: "note", noteId: id, page };
  }

  private selectionScope(selection: PaperSelection): CitationScope {
    return (selection.highlightId === undefined ? undefined : this.highlightScope(selection.highlightId)) ?? { kind: "passage", page: selection.page, text: selection.text };
  }

  private async showPaper(id: string): Promise<void> {
    const paper = this.papers.find((each) => each.id === id);
    if (!paper) return;
    const seq = ++this.readSeq;
    this.pages?.destroy();
    this.pages = undefined;
    this.shown = undefined;
    this.pageInView = undefined;
    this.picker.input.value = paper.title;
    this.dialog.showStatus(`Opening ${paper.title}…`);
    this.refresh();
    const [annotations, notes] = await Promise.all([
      this.source.annotationsOf(paper.id).catch((): Annotation[] => []),
      this.source.notesOf(paper.id).catch((): undefined => undefined),
    ]);
    if (this.done || seq !== this.readSeq) return;
    this.memory.paperId = paper.id;
    this.shown = { paper, lookups: { annotations, notes }, scope: { kind: "paper" } };
    this.choose({ kind: "paper" });
    this.mountPages(paper, annotations, notes, seq);
  }

  private mountPages(paper: PaperRecord, annotations: Annotation[], notes: ItemFile | undefined, seq: number): void {
    try {
      const view = mountPaperPages(this.pagesBox, {
        source: this.source.pdfOf(paper), annotations, notes: deriveNotePins(notes, annotations),
        onSelection: (selection) => this.choose(this.selectionScope(selection)),
        onHighlightClick: (highlightId) => this.choose(this.highlightScope(highlightId)),
        onNoteClick: (noteId) => this.choose(this.noteScope(noteId)),
        onPageInView: (page) => { this.pageInView = page; this.refresh(); },
      });
      this.pages = view;
      view.ready.then(() => { if (!this.done && seq === this.readSeq) this.dialog.showStatus(HINT); }, () => {
        if (!this.done && seq === this.readSeq) this.dialog.showStatus(`Could not open the PDF of ${paper.title}; the whole paper can still be cited.`, true);
      });
    } catch {
      this.dialog.showStatus(`${paper.title} has no PDF here; the whole paper can still be cited.`, true);
    }
  }

  private doInsert(): void {
    const chosen = this.pick();
    if (!chosen) return;
    this.dialog.close();
    this.finish(chosen);
  }

  private doCopy(): void {
    const chosen = this.pick();
    if (!chosen) return;
    void navigator.clipboard.writeText(chosen.text).then(() => showToast("Copied the citation", "ok"), () => showToast("Could not copy the citation", "error"));
    this.dialog.close();
    this.finish(undefined);
  }

  private onListed(listed: readonly PaperRecord[]): void {
    if (this.done) return;
    this.papers = listed;
    this.picker.setSuggestions(listed.map((paper) => ({ label: paper.title, detail: [`@${paper.citeKey}`, paper.year].filter((part) => part !== undefined).join(" · "), value: paper.id })));
    if (listed.length === 0) { this.dialog.showStatus("The library has no papers to cite.", true); return; }
    const { paperId } = this.memory;
    if (paperId !== undefined && listed.some((paper) => paper.id === paperId)) { void this.showPaper(paperId); return; }
    this.dialog.showStatus("Pick a paper");
    this.picker.input.focus();
  }
}

/**
 * Opens the Cite from Library popup.
 * @returns the pick to insert, or undefined when the popup was closed without inserting
 */
export function pickLibraryCitation(source: CitePickSource, memory: CitePickMemory): Promise<CitePick | undefined> {
  return new Promise((resolve) => { new CitePickPopup(source, memory, resolve); });
}
