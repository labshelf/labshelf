// Loads the checker of an editor's language, re-detects the language after an edit that may change it, and gives the
// notice its install and retry actions.
import type { StateEffect, EditorState } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { detectDocumentLanguage, type DocumentLanguage } from "../../proofing/index.js";
import { loadChecker, type LoadResult } from "./proofingCheckers.js";
import { configFacet, languageState, proofingField, proofingStateOf, ProofingStatus, type ProofingConfig } from "./proofingState.js";

const DETECT_DELAY_MS = 500;
const TYPST_LANGUAGE_LINE = /#set\s+text|\blang\s*:/;

// ---------------------------------------------------------------- Loading and language

/** Loads the checker of the language and re-detects the language after an edit that may change it. */
export class ProofingLoader {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;
  private preambleEnd: number;

  constructor(private readonly view: EditorView) {
    this.preambleEnd = this.findPreambleEnd(view.state.doc.toString());
    const { language, status } = view.state.field(proofingField);
    if (status === "loading" && language.tag !== null) this.load(language.tag);
  }

  update(update: ViewUpdate): void {
    if (!update.docChanged) return;
    const touched = this.touchesLanguage(update);
    if (Number.isFinite(this.preambleEnd)) this.preambleEnd = update.changes.mapPos(this.preambleEnd, -1);
    if (!touched) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.redetect(), DETECT_DELAY_MS);
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.timer);
  }

  private config(): ProofingConfig {
    return this.view.state.facet(configFacet)!;
  }

  private findPreambleEnd(text: string): number {
    if (this.config().format !== "latex") return Infinity;
    const at = text.indexOf("\\begin{document}");
    return at < 0 ? Infinity : at;
  }

  /** Whether an edit reached the preamble (LaTeX) or a line that sets the text's language (Typst). */
  private touchesLanguage(update: ViewUpdate): boolean {
    let hit = false;
    const latex = this.config().format === "latex";
    update.changes.iterChanges((fromA, toA, fromB, _toB, inserted) => {
      if (hit) return;
      if (latex) hit = fromA <= this.preambleEnd;
      else hit = TYPST_LANGUAGE_LINE.test(update.startState.doc.lineAt(fromA).text) || TYPST_LANGUAGE_LINE.test(update.state.doc.lineAt(fromB).text)
        || TYPST_LANGUAGE_LINE.test(update.startState.sliceDoc(fromA, toA)) || TYPST_LANGUAGE_LINE.test(inserted.toString());
    });
    return hit;
  }

  private redetect(): void {
    if (this.destroyed) return;
    const { store, format } = this.config();
    const text = this.view.state.doc.toString();
    this.preambleEnd = this.findPreambleEnd(text);
    const current = this.view.state.field(proofingField);
    const language = detectDocumentLanguage(format, text);
    if (language.tag === current.language.tag) {
      if (language.name === current.language.name && language.declared === current.language.declared) return;
      this.view.dispatch({ effects: ProofingStatus.of({ language, status: current.status, checker: current.checker }) });
      return;
    }
    const next = languageState(language, store);
    this.view.dispatch({ effects: ProofingStatus.of({ language, ...next }) });
    if (next.status === "loading" && language.tag !== null) this.load(language.tag);
  }

  private load(tag: string): void {
    const { store, logger } = this.config();
    void loadChecker(store, tag, logger).then((result) => {
      if (this.destroyed) return;
      const current = this.view.state.field(proofingField);
      if (current.language.tag !== tag) return;
      this.view.dispatch({ effects: statusEffect(current.language, result) });
    });
  }
}

function statusEffect(language: DocumentLanguage, result: LoadResult): StateEffect<unknown> {
  return ProofingStatus.of({
    language, status: result.status,
    checker: result.status === "ready" ? result.checker : undefined,
    error: result.status === "failed" ? result.error : undefined,
  });
}

/** Loads the checker of `tag` again after a failure; the effects set its status if the editor is still in that language. */
export function retryChecker(state: EditorState, tag: string): Promise<(state: EditorState) => readonly StateEffect<unknown>[]> {
  return loadStatusEffects(state, tag, false);
}

/** Installs the dictionary of `tag` through the store and loads its checker; the effects start checking if the editor is still in that language. */
export function installDictionary(state: EditorState, tag: string): Promise<(state: EditorState) => readonly StateEffect<unknown>[]> {
  return loadStatusEffects(state, tag, true);
}

/** Loads the checker of `tag`, installing its dictionary first when asked; the effects apply only while the editor is still in that language. */
async function loadStatusEffects(state: EditorState, tag: string, install: boolean): Promise<(state: EditorState) => readonly StateEffect<unknown>[]> {
  const { store, logger } = state.facet(configFacet)!;
  if (install) await store.install(tag);
  const result = await loadChecker(store, tag, logger);
  return (now) => {
    const current = proofingStateOf(now);
    if (!current || current.language.tag !== tag) return [];
    return [statusEffect(current.language, result)];
  };
}
