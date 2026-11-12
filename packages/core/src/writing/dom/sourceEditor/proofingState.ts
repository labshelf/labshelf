// The proofing state of an editor: the setting and state types, the effects that change it, the field that holds it and
// the accessors the linter, the spelling card and the notice read it through.
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { Facet, StateEffect, StateField, type ChangeDesc, type EditorState, type StateEffectType, type TransactionSpec } from "@codemirror/state";
import {
  accentMatch, acceptsWord, detectDocumentLanguage, rankCorrections, type DictionaryStore, type DocumentLanguage, type FrequencyList, type SpellChecker,
} from "../../proofing/index.js";
import type { ILogger } from "../../../ports/index.js";
import { cacheOf, correctionSources, frequencies, secondaryAccepts } from "./proofingCheckers.js";

/** The host's lasting choice: whether proofing runs, the machine-local dictionaries it reads and turning it off for good. */
export interface ProofingSetting {
  store: DictionaryStore;
  enabled: boolean;
  /** Stores proofing as off; the host says where to turn it back on. */
  disable(): void;
}

export type ProofingStatusName = "loading" | "ready" | "missing" | "unsupported" | "failed";

export interface ProofingState {
  language: DocumentLanguage;
  status: ProofingStatusName;
  /** Present when `status` is "ready". */
  checker?: SpellChecker | undefined;
  /** Why the checker could not start; present when `status` is "failed". */
  error?: string | undefined;
  /** Words this file ignores. */
  ignored: ReadonlySet<string>;
  /** The build problems, kept here so the linter's output and `applyProblems` do not replace each other. */
  problems: readonly Diagnostic[];
  /** What the last lint found, so `applyProblems` can set the build problems beside it. */
  found: readonly Diagnostic[];
}

export type ProseFormat = "latex" | "typst";

export interface ProofingConfig {
  store: DictionaryStore;
  format: ProseFormat;
  logger?: ILogger | undefined;
  /** The language of the document that includes this file, read once when the file declares none; absent, such a file is checked in en-US. */
  inherit?: ((text: string) => Promise<DocumentLanguage | null>) | undefined;
}

/** Sets the language and the checker's status; the linter runs again after it. */
export const ProofingStatus: StateEffectType<{ language: DocumentLanguage; status: ProofingStatusName; checker?: SpellChecker | undefined; error?: string | undefined }> = StateEffect.define();
export const ignoreWord = StateEffect.define<string>();
const setProblems = StateEffect.define<readonly Diagnostic[]>();
export const setFound = StateEffect.define<readonly Diagnostic[]>();
export const refreshLint = StateEffect.define<null>();

export const configFacet = Facet.define<ProofingConfig, ProofingConfig | undefined>({ combine: (values) => values[0] });

export function languageState(language: DocumentLanguage, store: DictionaryStore): Pick<ProofingState, "status" | "checker"> {
  if (language.tag === null) return { status: "unsupported" };
  const checker = cacheOf(store).ready.get(language.tag);
  return checker ? { status: "ready", checker } : { status: "loading" };
}

// ---------------------------------------------------------------- State

function mapDiagnostics(diagnostics: readonly Diagnostic[], changes: ChangeDesc): readonly Diagnostic[] {
  if (diagnostics.length === 0) return diagnostics;
  return diagnostics.map((diagnostic) => ({ ...diagnostic, from: changes.mapPos(diagnostic.from, 1), to: changes.mapPos(diagnostic.to, -1) }));
}

export const proofingField = StateField.define<ProofingState>({
  create(state) {
    const config = state.facet(configFacet)!;
    const language = detectDocumentLanguage(config.format, state.doc.toString());
    return { language, ...languageState(language, config.store), ignored: new Set(), problems: [], found: [] };
  },
  update(value, tr) {
    let next = value;
    if (tr.docChanged) next = { ...next, problems: mapDiagnostics(next.problems, tr.changes), found: mapDiagnostics(next.found, tr.changes) };
    for (const effect of tr.effects) {
      if (effect.is(ProofingStatus)) {
        const { language, status, checker, error } = effect.value;
        next = { ...next, language, status, checker, error };
      } else if (effect.is(ignoreWord)) next = { ...next, ignored: new Set([...next.ignored, effect.value]) };
      else if (effect.is(setProblems)) next = { ...next, problems: effect.value };
      else if (effect.is(setFound)) next = { ...next, found: effect.value };
    }
    return next;
  },
});

/** The language, checker status, ignored words and build problems of an editor; undefined without proofing. */
export function proofingStateOf(state: EditorState): ProofingState | undefined {
  return state.field(proofingField, false);
}

/** The dictionary store an editor proofs with; undefined without proofing. */
export function proofingStoreOf(state: EditorState): DictionaryStore | undefined {
  return state.facet(configFacet)?.store;
}

/** The checker of an editor's language; undefined until it is ready and without proofing. */
export function proofingCheckerOf(state: EditorState): SpellChecker | undefined {
  return proofingStateOf(state)?.checker;
}

/** The word frequency list of an editor's language; undefined until its checker is ready, and for a language without one. */
export function proofingFrequencyOf(state: EditorState): FrequencyList | undefined {
  const checker = proofingCheckerOf(state);
  return checker ? frequencies.get(checker) : undefined;
}

const isEnglish = (language: DocumentLanguage): boolean => (language.tag ?? "").toLowerCase().startsWith("en");

/**
 * Whether spelling accepts `word` in this editor: ignored in the file, or accepted by `acceptsWord` with the language's
 * checker and frequency list, and in a non-English document the English checker once it has loaded.
 */
export function proofingAccepts(state: EditorState, word: string, onSecondary?: () => void): boolean {
  const current = proofingStateOf(state);
  const config = state.facet(configFacet);
  const checker = current?.checker;
  if (!current || !config || !checker || current.ignored.has(word)) return true;
  const english = isEnglish(current.language);
  return acceptsWord(word, {
    check: (candidate) => checker.check(candidate),
    frequency: frequencies.get(checker),
    accentMatch: (candidate) => accentMatch(checker, candidate, correctionSources(checker)),
    secondary: english ? undefined : (candidate) => secondaryAccepts(config.store, config.logger, candidate, onSecondary ?? (() => undefined)) ?? false,
  });
}

/** The ranked corrections of `word` by `checker`, with that checker's frequency list and stems (see proofing/spelling.ts). */
export function proofingCorrections(checker: SpellChecker, word: string, limit = 8): string[] {
  return rankCorrections(checker, word, correctionSources(checker), limit);
}

/**
 * The transaction that sets the build problems beside the last spelling and rule diagnostics (setDiagnostics replaces
 * the linter's output), or null when the editor has no proofing and the problems alone are set.
 */
export function proofingProblems(state: EditorState, problems: readonly Diagnostic[]): TransactionSpec | null {
  const current = proofingStateOf(state);
  if (!current) return null;
  const effects: StateEffect<unknown>[] = [];
  return { effects: effects.concat(setDiagnostics(state, [...problems, ...current.found]).effects ?? [], setProblems.of(problems)) };
}
