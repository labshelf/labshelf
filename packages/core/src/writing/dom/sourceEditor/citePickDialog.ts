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

/**
 * Opens the Cite from Library popup.
 * @returns the pick to insert, or undefined when the popup was closed without inserting
 */
export function pickLibraryCitation(source: CitePickSource, memory: CitePickMemory): Promise<CitePick | undefined> {
  return new Promise((resolve) => {
    let papers: readonly PaperRecord[] = [];
    let shown: { paper: PaperRecord; lookups: CitationScopeLookups; scope: CitationScope } | undefined;
    let pages: { destroy(): void } | undefined;
    let pageInView: number | undefined;
    let done = false;
    let readSeq = 0;

    const finish = (pick: CitePick | undefined): void => {
      if (done) return;
      done = true;
      pages?.destroy();
      resolve(pick);
    };
    const picker = mountCombobox({ label: "Paper", suggestions: [], placeholder: "Type to filter by title, @key or year", listAll: true, onPick: (picked) => void showPaper(picked.value) });
    const preview = renderElement("code", { class: "ls-cite-pick-preview" });
    // The editor hosts load base.css, not the reader's sheet, so the buttons take its classes.
    const copy = renderTextButton("Copy", "ls-btn");
    const cancel = renderTextButton("Cancel", "ls-btn");
    const insert = renderTextButton("Insert", "ls-btn ls-btn-primary");
    insert.title = "Insert (Mod-Enter)";
    const dialog = renderPickerDialog({
      heading: "Cite from Library", pickers: [{ label: "Paper", control: picker.root }], leading: [preview], trailing: [copy, cancel, insert], onDismiss: () => finish(undefined),
    });
    const thisPage = renderTextButton("This page", "ls-btn");
    const wholePaper = renderTextButton("Whole paper", "ls-btn");
    const quoteBox = renderElement("input", { type: "checkbox" });
    const quoteField = renderElement("label", { class: "rd-cite-dialog-check ls-cite-pick-quote" }, quoteBox, "With the quotation");
    const what = renderElement("span", { class: "ls-cite-pick-what" });
    const scopes = renderElement("div", { class: "ls-cite-pick-scopes" }, thisPage, wholePaper, quoteField, what);
    const pagesBox = renderElement("div", { class: "ls-cite-pick-pages" });
    dialog.body.classList.add("ls-cite-pick-body");
    dialog.body.append(scopes, pagesBox);

    const pick = (): CitePick | undefined => {
      if (!shown) return undefined;
      const { paper, scope, lookups } = shown;
      const quoted = quotable(scope) && quoteBox.checked;
      return { paper, scope, quoted, text: createScopedCitation(source.format, paper.citeKey, scope, quoted, lookups) };
    };
    const refresh = (): void => {
      const chosen = pick();
      preview.textContent = chosen?.text ?? "";
      insert.disabled = copy.disabled = wholePaper.disabled = chosen === undefined;
      thisPage.disabled = chosen === undefined || pageInView === undefined;
      thisPage.textContent = pageInView === undefined ? "This page" : `This page (p. ${pageInView})`;
      quoteField.hidden = !chosen || !quotable(chosen.scope);
      what.textContent = chosen ? describeScope(chosen.scope) : "";
      wholePaper.setAttribute("aria-pressed", String(chosen?.scope.kind === "paper"));
      thisPage.setAttribute("aria-pressed", String(chosen?.scope.kind === "page"));
    };
    /** A new pick replaces the one before; the quotation starts on for the author's words, off for a note. */
    const choose = (scope: CitationScope | undefined): void => {
      if (!shown || !scope) return;
      shown.scope = scope;
      quoteBox.checked = scope.kind === "highlight" || scope.kind === "passage";
      refresh();
    };
    // A highlight or note scope keeps its page as read now, so the command without the quotation is known from the scope alone.
    const highlightScope = (id: string): CitationScope | undefined => {
      const highlight = shown?.lookups.annotations.find((annotation) => annotation.id === id);
      return highlight && { kind: "highlight", annotationId: id, page: highlight.pageNumber };
    };
    const noteScope = (id: string): CitationScope | undefined => {
      const note = shown && findScopeNote(shown.lookups.notes, id);
      if (!shown || !note) return undefined;
      const page = deriveNotePage(note, shown.lookups.annotations);
      return page === undefined ? { kind: "note", noteId: id } : { kind: "note", noteId: id, page };
    };
    const selectionScope = (selection: PaperSelection): CitationScope =>
      (selection.highlightId === undefined ? undefined : highlightScope(selection.highlightId)) ?? { kind: "passage", page: selection.page, text: selection.text };

    async function showPaper(id: string): Promise<void> {
      const paper = papers.find((each) => each.id === id);
      if (!paper) return;
      const seq = ++readSeq;
      pages?.destroy();
      pages = undefined;
      shown = undefined;
      pageInView = undefined;
      picker.input.value = paper.title;
      dialog.showStatus(`Opening ${paper.title}…`);
      refresh();
      const [annotations, notes] = await Promise.all([
        source.annotationsOf(paper.id).catch((): Annotation[] => []),
        source.notesOf(paper.id).catch((): undefined => undefined),
      ]);
      if (done || seq !== readSeq) return;
      memory.paperId = paper.id;
      shown = { paper, lookups: { annotations, notes }, scope: { kind: "paper" } };
      choose({ kind: "paper" });
      try {
        const view = mountPaperPages(pagesBox, {
          source: source.pdfOf(paper), annotations, notes: deriveNotePins(notes, annotations),
          onSelection: (selection) => choose(selectionScope(selection)),
          onHighlightClick: (highlightId) => choose(highlightScope(highlightId)),
          onNoteClick: (noteId) => choose(noteScope(noteId)),
          onPageInView: (page) => { pageInView = page; refresh(); },
        });
        pages = view;
        view.ready.then(() => { if (!done && seq === readSeq) dialog.showStatus(HINT); }, () => {
          if (!done && seq === readSeq) dialog.showStatus(`Could not open the PDF of ${paper.title}; the whole paper can still be cited.`, true);
        });
      } catch {
        dialog.showStatus(`${paper.title} has no PDF here; the whole paper can still be cited.`, true);
      }
    }

    const doInsert = (): void => {
      const chosen = pick();
      if (!chosen) return;
      dialog.close();
      finish(chosen);
    };
    const doCopy = (): void => {
      const chosen = pick();
      if (!chosen) return;
      void navigator.clipboard.writeText(chosen.text).then(() => showToast("Copied the citation", "ok"), () => showToast("Could not copy the citation", "error"));
      dialog.close();
      finish(undefined);
    };
    thisPage.addEventListener("click", () => { if (pageInView !== undefined) choose({ kind: "page", page: pageInView }); });
    wholePaper.addEventListener("click", () => choose({ kind: "paper" }));
    quoteBox.addEventListener("change", refresh);
    copy.addEventListener("click", doCopy);
    cancel.addEventListener("click", () => { dialog.close(); finish(undefined); });
    insert.addEventListener("click", doInsert);
    dialog.content.addEventListener("keydown", (event) => {
      if (!isModEnter(event) || event.defaultPrevented) return;
      event.preventDefault();
      doInsert();
    });

    refresh();
    dialog.showStatus("Listing the library's papers…");
    void source.papers().then((listed) => {
      if (done) return;
      papers = listed;
      picker.setSuggestions(listed.map((paper) => ({ label: paper.title, detail: [`@${paper.citeKey}`, paper.year].filter((part) => part !== undefined).join(" · "), value: paper.id })));
      if (listed.length === 0) { dialog.showStatus("The library has no papers to cite.", true); return; }
      if (memory.paperId !== undefined && listed.some((paper) => paper.id === memory.paperId)) { void showPaper(memory.paperId); return; }
      dialog.showStatus("Pick a paper");
      picker.input.focus();
    }, () => { if (!done) dialog.showStatus("Could not list the library's papers.", true); });
  });
}
