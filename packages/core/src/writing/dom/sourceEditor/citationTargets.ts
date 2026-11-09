// Completes what a citation of a library paper points at (the paper, a page, a highlight, a note) in the LaTeX and Typst editors, and the page argument from the paper's highlights and notes.
import { pickedCompletion, startCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { EditorSelection, type ChangeSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  PAGE_SLOT,
  deriveCitedKeyContext,
  deriveNotePageSupplement,
  deriveNoteProseBefore,
  derivePageArgument,
  derivePageSupplement,
  derivePapersByCiteKey,
  deriveQuotationBefore,
  formatCiteTarget,
  listCiteTargets,
  rewriteCitation,
  type Annotation,
  type CiteTarget,
  type CitedKeyContext,
  type ItemFile,
  type PaperNotesStore,
  type PaperRecord,
  type ProjectFormat,
} from "../../../index.js";

export interface CiteTargetDeps {
  format: ProjectFormat;
  papers(): Promise<readonly PaperRecord[]>;
  /** The paper's highlights; without it a citation offers no highlight. */
  highlightsOf?: ((paperId: string) => Promise<Annotation[]>) | undefined;
  /** The paper's notes; without them a citation offers no note. */
  notes?: Pick<PaperNotesStore, "read"> | undefined;
}

/** What a paper has to point at; each side that cannot be read is empty. */
interface PaperTargets { annotations: Annotation[]; notes: ItemFile | undefined }

const CACHE_MS = 3000;

/** Reads a paper's highlights and notes, remembering them for a few seconds so typing in a list does not ask again at every key. */
function createTargetLoader({ highlightsOf, notes }: Pick<CiteTargetDeps, "highlightsOf" | "notes">): (paperId: string) => Promise<PaperTargets> {
  const cache = new Map<string, { at: number; targets: Promise<PaperTargets> }>();
  return (paperId) => {
    const hit = cache.get(paperId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.targets;
    const targets = Promise.all([
      highlightsOf ? highlightsOf(paperId).catch((): Annotation[] => []) : [],
      notes ? notes.read(paperId).catch((): undefined => undefined) : undefined,
    ]).then(([annotations, file]) => ({ annotations, notes: file }));
    cache.set(paperId, { at: Date.now(), targets });
    return targets;
  };
}

/** The library paper a cite key names, with its highlights and notes; undefined for a key no library paper has. */
export function createCitedPaperLoader(deps: Pick<CiteTargetDeps, "papers" | "highlightsOf" | "notes">): (key: string) => Promise<(PaperTargets & { paper: PaperRecord }) | undefined> {
  const load = createTargetLoader(deps);
  return async (key) => {
    const paper = derivePapersByCiteKey(await deps.papers()).get(key);
    return paper ? { paper, ...await load(paper.id) } : undefined;
  };
}

/** Whether a paper can offer anything beyond a typed page, so a list is worth opening by itself. */
export const hasTargetSources = (deps: Pick<CiteTargetDeps, "highlightsOf" | "notes">): boolean => Boolean(deps.highlightsOf ?? deps.notes);

// --- Targets of the key at the cursor ---

function targetOption(deps: CiteTargetDeps, context: CitedKeyContext, lineFrom: number, target: CiteTarget): Completion {
  const { label, detail } = formatCiteTarget(target);
  return {
    label, detail, type: "text",
    apply(view: EditorView, completion: Completion) {
      const from = lineFrom + context.commandStart;
      const to = lineFrom + context.commandEnd;
      const written = rewriteCitation(deps.format, context, target);
      if (written === undefined) {
        view.dispatch({ selection: EditorSelection.cursor(to), annotations: pickedCompletion.of(completion), userEvent: "input.complete" });
        return;
      }
      const slot = written.indexOf(PAGE_SLOT);
      const insert = written.replace(PAGE_SLOT, "");
      view.dispatch({
        changes: { from, to, insert },
        selection: EditorSelection.cursor(from + (slot === -1 ? insert.length : slot)),
        annotations: pickedCompletion.of(completion), userEvent: "input.complete", scrollIntoView: true,
      });
    },
  };
}

/** Items for the citation whose single key ends at the cursor, when the key is a library paper; shown on explicit completion. */
export function createCiteTargetCompletion(deps: CiteTargetDeps): CompletionSource {
  const load = createCitedPaperLoader(deps);
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    if (!context.explicit) return null;
    const line = context.state.doc.lineAt(context.pos);
    const column = context.pos - line.from;
    const cited = deriveCitedKeyContext(deps.format, line.text.slice(0, column), line.text.slice(column));
    const found = cited && await load(cited.key);
    if (!cited || !found) return null;
    const { annotations, notes } = found;
    const options = listCiteTargets(annotations, notes).map((target) => targetOption(deps, cited, line.from, target));
    // The span is the whole citation, so the typed text does not filter; the list stays in target order.
    return { from: line.from + cited.commandStart, to: line.from + cited.commandEnd, options, filter: false };
  };
}

/** After a paper key is accepted: opens the targets list when the key now stands alone in its citation. */
export function offerCiteTargets(view: EditorView, format: ProjectFormat): void {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  const column = head - line.from;
  if (deriveCitedKeyContext(format, line.text.slice(0, column), line.text.slice(column))) startCompletion(view);
}

// --- Page argument ---

/** Items for `\cite[|]{key}` and `@key[|`: the paper's highlights and notes with a page, each as its page or with its text before the citation. */
export function createPageArgumentCompletion(deps: CiteTargetDeps): CompletionSource {
  const load = createCitedPaperLoader(deps);
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const line = context.state.doc.lineAt(context.pos);
    const column = context.pos - line.from;
    const page = derivePageArgument(deps.format, line.text.slice(0, column), line.text.slice(column));
    const found = page?.key === undefined ? undefined : await load(page.key);
    if (!page || !found) return null;
    const { annotations, notes } = found;
    const options = listCiteTargets(annotations, notes).flatMap((target): Completion[] => {
      const written = pageArgumentText(deps.format, target);
      if (written === undefined) return [];
      const { label, detail } = formatCiteTarget(target);
      return [{
        label, detail, type: "text",
        apply(view: EditorView, completion: Completion) {
          const supplementFrom = line.from + page.start;
          const supplementTo = line.from + (page.close ?? column);
          const changes: ChangeSpec[] = [{ from: supplementFrom, to: supplementTo, insert: written.supplement }];
          if (written.before !== "") changes.unshift({ from: line.from + page.commandStart, insert: written.before });
          view.dispatch({
            changes,
            selection: EditorSelection.cursor(supplementFrom + written.before.length + written.supplement.length),
            annotations: pickedCompletion.of(completion), userEvent: "input.complete", scrollIntoView: true,
          });
        },
      }];
    });
    return { from: line.from + page.start, to: line.from + (page.close ?? column), options, filter: false };
  };
}

/** The page a highlight or note names and what goes before the command; undefined for targets with no page. */
function pageArgumentText(format: ProjectFormat, target: CiteTarget): { supplement: string; before: string } | undefined {
  switch (target.kind) {
    case "highlight": return { supplement: derivePageSupplement(format, target.page), before: target.quote ? deriveQuotationBefore(format, target.text) : "" };
    case "note": {
      const supplement = deriveNotePageSupplement(format, target);
      return supplement === undefined ? undefined : { supplement, before: target.withText ? deriveNoteProseBefore(format, target.text) : "" };
    }
    default: return undefined;
  }
}
