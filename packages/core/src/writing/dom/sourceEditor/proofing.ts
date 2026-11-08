// Proofs the prose of a LaTeX or Typst source as it is typed: spelling in the language the document declares and the simple rules,
// as lint diagnostics with their quick fixes. The checker comes from the host's dictionary store and is shared by every editor on it.
import { forceLinting, linter, setDiagnostics, type Action, type Diagnostic } from "@codemirror/lint";
import { Facet, StateEffect, StateField, type ChangeDesc, type EditorState, type Extension, type StateEffectType, type TransactionSpec } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import {
  accentMatch, acceptsWord, checkSimpleRules, createSpellChecker, detectDocumentLanguage, findProseRanges, parseFrequencyList, proseWords,
  rankCorrections, stemIndex, type CorrectionSources, type DictionaryStore, type DocumentLanguage, type FrequencyList, type ProseRange, type SpellChecker,
} from "../../proofing/index.js";
import type { ILogger } from "../../../ports/index.js";
import { proofingNotice } from "./proofingNotice.js";
import { spellingCard, spellingCardTheme, withoutSpelling } from "./spellingCard.js";

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

type ProseFormat = "latex" | "typst";

interface ProofingConfig { store: DictionaryStore; format: ProseFormat; logger?: ILogger | undefined }

const LOG_MODULE = "proofing";

/** Sets the language and the checker's status; the linter runs again after it. */
export const ProofingStatus: StateEffectType<{ language: DocumentLanguage; status: ProofingStatusName; checker?: SpellChecker | undefined; error?: string | undefined }> = StateEffect.define();
const ignoreWord = StateEffect.define<string>();
const setProblems = StateEffect.define<readonly Diagnostic[]>();
const setFound = StateEffect.define<readonly Diagnostic[]>();
const refreshLint = StateEffect.define<null>();

const configFacet = Facet.define<ProofingConfig, ProofingConfig | undefined>({ combine: (values) => values[0] });

const WINDOW_MARGIN = 2000;
const LINT_DELAY_MS = 400;
const DETECT_DELAY_MS = 500;
const MAX_DIAGNOSTICS = 500;
const FALLBACK_WINDOW = 4000;
const TYPST_LANGUAGE_LINE = /#set\s+text|\blang\s*:/;

// ---------------------------------------------------------------- Checkers

type LoadResult = { status: "ready"; checker: SpellChecker } | { status: "missing" } | { status: "failed"; error: string };

interface StoreCache {
  loads: Map<string, Promise<LoadResult>>;
  ready: Map<string, SpellChecker>;
}

const caches = new WeakMap<DictionaryStore, StoreCache>();
/** The word frequency list read with each checker's dictionary, when it had one. */
const frequencies = new WeakMap<SpellChecker, FrequencyList>();
/** The bare stems of each checker's dictionary, which corrections may offer. */
const stemsOf = new WeakMap<SpellChecker, readonly string[]>();

/** The dictionary that also accepts English terms in a document of another language. */
const SECONDARY_TAG = "en-US";

/** The English checker of a store for documents in another language, with its verdicts per word; null once it could not load. */
interface Secondary { checker: SpellChecker | null; verdicts: Map<string, boolean> }

const secondaries = new WeakMap<DictionaryStore, Promise<Secondary>>();
const secondaryReady = new WeakMap<DictionaryStore, Secondary>();

function cacheOf(store: DictionaryStore): StoreCache {
  let cache = caches.get(store);
  if (!cache) {
    cache = { loads: new Map(), ready: new Map() };
    caches.set(store, cache);
  }
  return cache;
}

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().replace(/\.$/, "") || "unknown error";
}

/** The checker of `tag` in `store`, read and built once; a missing or failed load is tried again next time, and a failure is logged. */
function loadChecker(store: DictionaryStore, tag: string, logger: ILogger | undefined): Promise<LoadResult> {
  const cache = cacheOf(store);
  const existing = cache.loads.get(tag);
  if (existing) return existing;
  const load = (async (): Promise<LoadResult> => {
    try {
      const files = await store.read(tag);
      if (!files) return { status: "missing" };
      const checker = await createSpellChecker(files, await store.userWords());
      if (files.freq) frequencies.set(checker, parseFrequencyList(files.freq));
      stemsOf.set(checker, stemIndex(files.dic).stems);
      cache.ready.set(tag, checker);
      return { status: "ready", checker };
    } catch (error: unknown) {
      if (logger) void logger.error(LOG_MODULE, error, { action: "start spell checker", language: tag });
      return { status: "failed", error: messageOf(error) };
    }
  })();
  cache.loads.set(tag, load);
  void load.then((result) => { if (result.status !== "ready" && cache.loads.get(tag) === load) cache.loads.delete(tag); });
  return load;
}

function languageState(language: DocumentLanguage, store: DictionaryStore): Pick<ProofingState, "status" | "checker"> {
  if (language.tag === null) return { status: "unsupported" };
  const checker = cacheOf(store).ready.get(language.tag);
  return checker ? { status: "ready", checker } : { status: "loading" };
}

// ---------------------------------------------------------------- State

function mapDiagnostics(diagnostics: readonly Diagnostic[], changes: ChangeDesc): readonly Diagnostic[] {
  if (diagnostics.length === 0) return diagnostics;
  return diagnostics.map((diagnostic) => ({ ...diagnostic, from: changes.mapPos(diagnostic.from, 1), to: changes.mapPos(diagnostic.to, -1) }));
}

const proofingField = StateField.define<ProofingState>({
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

/** Whether `word` is English in a non-English document; undefined while the English checker loads, which starts it. */
function secondaryAccepts(store: DictionaryStore, logger: ILogger | undefined, word: string, onReady: () => void): boolean | undefined {
  const ready = secondaryReady.get(store);
  if (ready) {
    if (!ready.checker) return false;
    let verdict = ready.verdicts.get(word);
    if (verdict === undefined) ready.verdicts.set(word, (verdict = ready.checker.check(word)));
    return verdict;
  }
  let load = secondaries.get(store);
  if (!load) {
    load = loadChecker(store, SECONDARY_TAG, logger).then((result) => {
      const secondary: Secondary = { checker: result.status === "ready" ? result.checker : null, verdicts: new Map() };
      secondaryReady.set(store, secondary);
      return secondary;
    });
    secondaries.set(store, load);
  }
  void load.then(onReady);
  return undefined;
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

function correctionSources(checker: SpellChecker): CorrectionSources {
  return { frequency: frequencies.get(checker), stems: stemsOf.get(checker) };
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

// ---------------------------------------------------------------- Loading and language

/** Loads the checker of the language and re-detects the language after an edit that may change it. */
class ProofingLoader {
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
function retryChecker(state: EditorState, tag: string): Promise<(state: EditorState) => readonly StateEffect<unknown>[]> {
  return loadStatusEffects(state, tag, false);
}

/** Installs the dictionary of `tag` through the store and loads its checker; the effects start checking if the editor is still in that language. */
function installDictionary(state: EditorState, tag: string): Promise<(state: EditorState) => readonly StateEffect<unknown>[]> {
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

// ---------------------------------------------------------------- Linting

/** The visible ranges widened by the margin, merged, and moved out to whitespace so no word is cut. */
function lintWindows(view: EditorView, text: string): ProseRange[] {
  const length = text.length;
  const ranges: ProseRange[] = view.visibleRanges.map((range) => ({ from: Math.max(0, range.from - WINDOW_MARGIN), to: Math.min(length, range.to + WINDOW_MARGIN) }));
  if (ranges.length === 0) ranges.push({ from: 0, to: Math.min(length, FALLBACK_WINDOW) });
  ranges.sort((a, b) => a.from - b.from);
  const merged: ProseRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  for (const range of merged) {
    while (range.from > 0 && !/\s/.test(text[range.from - 1] ?? " ")) range.from -= 1;
    while (range.to < length && !/\s/.test(text[range.to] ?? " ")) range.to += 1;
  }
  return merged;
}

function addToDictionary(view: EditorView, word: string): void {
  const store = proofingStoreOf(view.state);
  if (!store) return;
  const finish = (): void => {
    for (const checker of cacheOf(store).ready.values()) checker.addWord(word);
    view.dispatch({ effects: refreshLint.of(null) });
    forceLinting(view);
  };
  // The word is accepted for this session even when the store cannot keep it; the store's error still surfaces.
  void store.addUserWord(word).then(finish, (error: unknown) => { finish(); throw error; });
}

function ignoreInFile(view: EditorView, word: string): void {
  view.dispatch({ effects: ignoreWord.of(word) });
  forceLinting(view);
}

function spellingActions(word: string): Action[] {
  return [
    { name: "Add to dictionary", apply: (view) => addToDictionary(view, word) },
    { name: "Ignore in this file", apply: (view) => ignoreInFile(view, word) },
  ];
}

function proofText(view: EditorView, current: ProofingState, checker: SpellChecker, format: ProseFormat): Diagnostic[] {
  const text = view.state.doc.toString();
  const found: Diagnostic[] = [];
  let waiting = false;
  // The English checker loads on the first word it is asked about; the editor lints again once it is there.
  const relint = (): void => {
    if (waiting) return;
    waiting = true;
    view.dispatch({ effects: refreshLint.of(null) });
    forceLinting(view);
  };
  for (const window of lintWindows(view, text)) {
    const ranges = findProseRanges(format, text, window.from, window.to);
    for (const { from, to, word } of proseWords(text, ranges)) {
      if (current.ignored.has(word) || checker.check(word) || proofingAccepts(view.state, word, relint)) continue;
      found.push({
        from, to, severity: "warning", source: "spelling",
        message: `"${word}" is not in the ${current.language.name} dictionary. Ctrl+Space shows corrections.`,
        actions: spellingActions(word),
      });
    }
    for (const finding of checkSimpleRules(text, ranges, current.language.tag ?? "")) {
      const { fix } = finding;
      found.push({
        from: finding.from, to: finding.to, severity: "info", source: "writing", message: finding.message,
        // The diagnostic may have moved since it was found; the fix moves with it.
        actions: [{
          name: "Fix",
          apply: (editor, actionFrom) => {
            const shift = actionFrom - finding.from;
            editor.dispatch({ changes: { from: fix.from + shift, to: fix.to + shift, insert: fix.insert } });
          },
        }],
      });
    }
  }
  return found.sort((a, b) => a.from - b.from || a.to - b.to).slice(0, MAX_DIAGNOSTICS);
}

function proofingSource(view: EditorView): Diagnostic[] {
  const config = view.state.facet(configFacet);
  const current = proofingStateOf(view.state);
  if (!config || !current) return [];
  const found = current.status === "ready" && current.checker ? proofText(view, current, current.checker, config.format) : [];
  if (found.length > 0 || current.found.length > 0) view.dispatch({ effects: setFound.of(found) });
  return [...current.problems, ...found];
}

function needsRefresh(update: ViewUpdate): boolean {
  return update.viewportChanged || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(ProofingStatus) || effect.is(ignoreWord) || effect.is(refreshLint)));
}

/** The proofing extension of a LaTeX or Typst editor; nothing when the setting is absent or off. A checker that cannot start is logged through `logger`. */
export function createProofing(setting: ProofingSetting | undefined, format: ProseFormat, logger?: ILogger): Extension {
  if (!setting?.enabled) return [];
  return [
    configFacet.of({ store: setting.store, format, logger }),
    proofingField,
    ViewPlugin.fromClass(ProofingLoader),
    // The spelling card stands in for the lint tooltip of a misspelling; the lint panel still lists it.
    linter(proofingSource, { delay: LINT_DELAY_MS, needsRefresh, tooltipFilter: withoutSpelling }),
    spellingCard({ checker: proofingCheckerOf, corrections: proofingCorrections, ignore: ignoreInFile, addToDictionary }),
    spellingCardTheme,
    proofingNotice({ current: proofingStateOf, install: installDictionary, retry: retryChecker }),
  ];
}
