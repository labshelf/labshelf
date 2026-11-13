// Cite from Library in the source editor: opens the popup (loaded on first use), writes the citation at the cursor, and
// hands the host the scope record anchored to the inserted command (plan editor-cite-popup D1, D3).
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { randomHex } from "../../../encoding/bytes.js";
import { formatError, type Annotation, type ILogger, type ItemFile, type PaperRecord, type ProjectFormat } from "../../../index.js";
import { showToast } from "../../../ui/dom/index.js";
import { createScopedCitation, recordCitationScope, type CitationScope, type CitationScopeLookups, type CitationScopeRecord } from "../../citations/citationScopes.js";
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

/** Writes the pick at the cursor, saves its scope and brings the paper into the bibliography; a scope that cannot be saved leaves the citation in place. */
async function writeCitation(view: EditorView, deps: LibraryCitationDeps, pick: CitePick, { file, logger }: { file: string; logger: ILogger }): Promise<void> {
  const record = insertScopedCitation(view, deps.format, pick, { id: randomHex(8), file, createdAt: new Date().toISOString() });
  showToast(`Cited ${pick.paper.citeKey}`, "ok");
  try {
    await deps.saveScope(record);
  } catch (error) {
    void logger.log("WARN", MODULE, "Could not save the citation's scope", { key: record.key, error: formatError(error) });
  }
  await deps.refreshBibliography();
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
      await writeCitation(view, deps, pick, { file, logger });
    } catch (error) {
      void logger.error(MODULE, error, { action: "citeFromLibrary" });
      showToast(`Could not cite from the library: ${formatError(error)}`, "error");
    }
  };
}

/** Citing a paper by id with a scope chosen elsewhere (a consult window): the exact text first, then the citation written as Cite from Library writes it. */
export interface ScopedCiting {
  text(paperId: string, scope: CitationScope, quoted: boolean): Promise<string>;
  cite(view: EditorView, paperId: string, scope: CitationScope, quoted: boolean): Promise<void>;
}

/** The paper and the highlights and notes a scope's text is read from; rejects a paper the library no longer has. */
async function readCitable(deps: LibraryCitationDeps, paperId: string): Promise<{ paper: PaperRecord; lookups: CitationScopeLookups }> {
  const paper = (await deps.papers()).find((candidate) => candidate.id === paperId);
  if (!paper) throw new Error("That paper is no longer in the library.");
  const [annotations, notes] = await Promise.all([deps.annotationsOf(paperId), deps.notesOf(paperId)]);
  return { paper, lookups: { annotations, notes } };
}

function createScopedCiting(deps: LibraryCitationDeps, { file, logger }: { file: string; logger: ILogger }): ScopedCiting {
  const text = async (paperId: string, scope: CitationScope, quoted: boolean): Promise<string> => {
    const { paper, lookups } = await readCitable(deps, paperId);
    return createScopedCitation(deps.format, paper.citeKey, scope, quoted, lookups);
  };
  return {
    text,
    async cite(view, paperId, scope, quoted) {
      try {
        const { paper, lookups } = await readCitable(deps, paperId);
        const pick: CitePick = { paper, scope, quoted, text: createScopedCitation(deps.format, paper.citeKey, scope, quoted, lookups) };
        await writeCitation(view, deps, pick, { file, logger });
      } catch (error) {
        void logger.error(MODULE, error, { action: "citeFromConsult" });
        showToast(`Could not cite: ${formatError(error)}`, "error");
      }
    },
  };
}

/** The citation ports of a mounted source editor, read from its own ports; undefined without `deps.libraryCitation`. A paper the host has no PDF for can still be cited whole. */
function editorCitationDeps(deps: SourceEditorDeps): LibraryCitationDeps | undefined {
  const { libraryCitation, papers, pdfOf, highlightsOf, notes, path } = deps;
  if (!libraryCitation) return undefined;
  return {
    ...libraryCitation, format: deriveSourceLanguage(path), papers,
    pdfOf: (paper) => {
      const source = pdfOf?.(paper);
      if (!source) throw new Error(`No PDF of ${paper.title}`);
      return source;
    },
    annotationsOf: async (paperId) => (highlightsOf ? highlightsOf(paperId) : []),
    notesOf: async (paperId) => notes?.read(paperId),
  };
}

/** The Cite from Library action of a mounted source editor; undefined without `deps.libraryCitation`. */
export function createEditorLibraryCitation(deps: SourceEditorDeps): ((view: EditorView) => Promise<void>) | undefined {
  const citation = editorCitationDeps(deps);
  return citation && createLibraryCitation(citation, { file: deps.path, logger: deps.logger });
}

/** The scoped citing of a mounted source editor, for its consult windows; undefined without `deps.libraryCitation`. */
export function createEditorScopedCiting(deps: SourceEditorDeps): ScopedCiting | undefined {
  const citation = editorCitationDeps(deps);
  return citation && createScopedCiting(citation, { file: deps.path, logger: deps.logger });
}
