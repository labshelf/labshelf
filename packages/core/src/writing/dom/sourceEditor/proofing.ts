// Proofs the prose of a LaTeX or Typst source as it is typed: spelling in the language the document declares and the simple rules,
// as lint diagnostics with their quick fixes. The checker comes from the host's dictionary store and is shared by every editor on it.
import { forceLinting, linter, type Action, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { ILogger } from "../../../ports/index.js";
import { checkSimpleRules, findProseRanges, proseWords, type ProseRange, type SpellChecker } from "../../proofing/index.js";
import { cacheOf } from "./proofingCheckers.js";
import { proofingNotice } from "./proofingNotice.js";
import { installDictionary, ProofingLoader, retryChecker } from "./proofingLoader.js";
import {
  configFacet, ignoreWord, proofingAccepts, proofingCheckerOf, proofingCorrections, proofingField, proofingStateOf, ProofingStatus,
  proofingStoreOf, refreshLint, setFound, type ProofingSetting, type ProofingState, type ProseFormat,
} from "./proofingState.js";
import { spellingCard, spellingCardTheme, withoutSpelling } from "./spellingCard.js";

export {
  proofingAccepts, proofingCheckerOf, proofingCorrections, proofingFrequencyOf, proofingProblems, proofingStateOf, ProofingStatus, proofingStoreOf,
  type ProofingSetting, type ProofingState, type ProofingStatusName,
} from "./proofingState.js";

const LINT_DELAY_MS = 400;
const WINDOW_MARGIN = 2000;
const MAX_DIAGNOSTICS = 500;
const FALLBACK_WINDOW = 4000;

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
