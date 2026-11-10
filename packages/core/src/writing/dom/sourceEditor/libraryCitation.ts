// Cite from Library in the source editor: opens the popup (loaded on first use), writes the citation at the cursor, and
// hands the host the scope record anchored to the inserted command (plan editor-cite-popup D1, D3).
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { randomHex } from "../../../encoding/bytes.js";
import { formatError, type Annotation, type ILogger, type ItemFile, type PaperRecord, type ProjectFormat } from "../../../index.js";
import { showToast } from "../../../ui/dom/index.js";
import { createScopedCitation, recordCitationScope, type CitationScopeRecord } from "../../citations/citationScopes.js";
import type { CitePick, CitePickMemory } from "./citePickDialog.js";
import type { SourceEditorDeps } from "./editor.js";
import { deriveSourceLanguage } from "./formatting.js";
import type { PaperPdfSource } from "./paperPages.js";
import { reviewEdit } from "./review.js";

const MODULE = "editor.libraryCitation";

/** What a host gives Cite from Library: the library's papers and their PDF, highlights and notes, and where scopes and the bibliography go. */
export interface LibraryCitationDeps {
  format: ProjectFormat;
  papers(): Promise<readonly PaperRecord[]>;
  pdfOf(paper: PaperRecord): PaperPdfSource;
  annotationsOf(paperId: string): Promise<Annotation[]>;
  notesOf(paperId: string): Promise<ItemFile | undefined>;
  /** Appends the record to the project's .labshelf/citations.json. */
  saveScope(record: CitationScopeRecord): Promise<void>;
  /** Brings the cited paper into the project's bibliography. */
  refreshBibliography(): Promise<void>;
}

/**
 * Writes the pick over the main selection, the cursor after it.
 * @returns the scope record, anchored to the citation command alone (not the quotation before it)
 */
export function insertScopedCitation(
  view: EditorView, format: ProjectFormat, pick: CitePick, fields: Pick<CitationScopeRecord, "id" | "file" | "createdAt">,
): CitationScopeRecord {
  const { from, to } = view.state.selection.main;
  const { text, paper, scope } = pick;
  view.dispatch(view.state.update({
    changes: { from, to, insert: text }, selection: EditorSelection.cursor(from + text.length),
    scrollIntoView: true, userEvent: "input", annotations: reviewEdit.of(true),
  }));
  // INVARIANT: the popup keeps a highlight's or note's page in its scope, so the command alone needs no lookups; it ends the inserted text.
  const command = createScopedCitation(format, paper.citeKey, scope, false, { annotations: [], notes: undefined });
  const end = from + text.length;
  return recordCitationScope(view.state.doc.toString(), { start: end - command.length, end }, { ...fields, key: paper.citeKey, scope });
}

/**
 * The editor's Cite from Library action for the project-relative source `file`; the paper last picked opens first, for
 * this action's life. A scope that cannot be saved leaves the citation in place, as a citation without a scope.
 */
export function createLibraryCitation(deps: LibraryCitationDeps, { file, logger }: { file: string; logger: ILogger }): (view: EditorView) => Promise<void> {
  const memory: CitePickMemory = {};
  return async (view) => {
    try {
      const { pickLibraryCitation } = await import("./citePickDialog.js");
      const pick = await pickLibraryCitation(deps, memory);
      if (!pick) return;
      const record = insertScopedCitation(view, deps.format, pick, { id: randomHex(8), file, createdAt: new Date().toISOString() });
      showToast(`Cited ${pick.paper.citeKey}`, "ok");
      try {
        await deps.saveScope(record);
      } catch (error) {
        void logger.log("WARN", MODULE, "Could not save the citation's scope", { key: record.key, error: formatError(error) });
      }
      await deps.refreshBibliography();
    } catch (error) {
      void logger.error(MODULE, error, { action: "citeFromLibrary" });
      showToast(`Could not cite from the library: ${formatError(error)}`, "error");
    }
  };
}

/**
 * The action of a mounted source editor, reading the papers, PDFs, highlights and notes from the editor's own ports;
 * undefined without `deps.libraryCitation`. A paper the host has no PDF for can still be cited whole.
 */
export function createEditorLibraryCitation(deps: SourceEditorDeps): ((view: EditorView) => Promise<void>) | undefined {
  const { libraryCitation, papers, pdfOf, highlightsOf, notes, path, logger } = deps;
  if (!libraryCitation) return undefined;
  return createLibraryCitation({
    ...libraryCitation, format: deriveSourceLanguage(path), papers,
    pdfOf: (paper) => {
      const source = pdfOf?.(paper);
      if (!source) throw new Error(`No PDF of ${paper.title}`);
      return source;
    },
    annotationsOf: async (paperId) => (highlightsOf ? highlightsOf(paperId) : []),
    notesOf: async (paperId) => notes?.read(paperId),
  }, { file: path, logger });
}
