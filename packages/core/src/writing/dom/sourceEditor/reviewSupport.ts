/** Review support: the mounted editor's review mode, keeping the file's suggestion list in step with the tracked changes. */
import type { EditorState, Extension, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { AUTO_SAVE_DELAY_MS, createDebouncer, type EditorSuggestions, type FileSuggestion, type ILogger, type ReviewMode } from "../../../index.js";
import { docOffsetToFile, fileOffsetToDoc } from "../../../collab/dom/index.js";
import { createReviewTracking, type ReviewTracking, type TrackedChange } from "./reviewTracking.js";
import { createReviewView, reviewModeDropdown } from "./reviewView.js";
import type { SourceToolbarDropdown } from "./toolbar.js";

export type { EditorSuggestions, FileSuggestion, ReviewMode };

/** What the editor needs for review mode. */
export interface EditorReview {
  /** The name a new suggestion is recorded under. */
  author(): string;
  /** The mode the editor opens in. */
  mode: ReviewMode;
  suggestions: EditorSuggestions;
  /** Runs when the user picks a mode in the toolbar. */
  onMode?(mode: ReviewMode): void;
}

const REVIEW_MODULE = "editor.review";

function suggestionKey(s: FileSuggestion): string {
  return JSON.stringify([s.kind, s.start, s.end, s.text, s.group, s.author, s.created]);
}

function toFileSuggestion(change: TrackedChange, doc: Text, lineBreak: string): FileSuggestion {
  const { id, kind, author, created, text, group } = change;
  return {
    id, kind, start: docOffsetToFile(doc, lineBreak, change.from), end: docOffsetToFile(doc, lineBreak, change.to), author, created,
    ...(text === undefined ? {} : { text }), ...(group === undefined ? {} : { group }),
  };
}

/** The record of a file suggestion in the editor's text; null when its offsets do not fit the text. */
function toTrackedChange(s: FileSuggestion, fileText: string, length: number): TrackedChange | null {
  const from = fileOffsetToDoc(fileText, s.start);
  const to = s.kind === "delete" ? from : fileOffsetToDoc(fileText, s.end);
  if (from < 0 || to > length || to < from || (s.kind === "insert" && to === from)) { return null; }
  const { id, kind, author, created, text, group } = s;
  return { id, kind, from, to, author, created, ...(text === undefined ? {} : { text }), ...(group === undefined ? {} : { group }) };
}

/** The mounted editor's review: tracking, its view, and the sync with the file's suggestions. */
export interface ReviewSupport {
  extensions: Extension[];
  /** Loads the file's suggestions and opens in the review's mode; returns the stop function. */
  attach(view: EditorView): () => void;
  /** Sends the suggestions recorded or resolved since the last send; call it when the editor's text is the saved file's. */
  saved(): void;
  setMode(mode: ReviewMode): void;
  /** Switches between Editing and Reviewing, telling the host as the dropdown does. */
  toggle(): void;
  dropdown: SourceToolbarDropdown;
}

export interface ReviewSupportDeps {
  lineBreak: string;
  /** The text last written to the file, which the port's offsets are in. */
  savedText(): string;
  /** A shared text has no save the editor sees, so its changes are sent after the autosave delay. */
  shared: boolean;
  logger: ILogger;
}

interface SendState { sent: Map<string, string>; pending: Set<string> }

/** Sends the suggestions to the port, recording each as sent at once and undoing that when the port refuses. */
function pushSuggestions(review: EditorReview, logger: ILogger, state: SendState, added: readonly FileSuggestion[], removed: readonly string[]): void {
  const previous = new Map(state.sent);
  const restore = (id: string): void => { const key = previous.get(id); if (key === undefined) { state.sent.delete(id); } else { state.sent.set(id, key); } };
  for (const s of added) { state.sent.set(s.id, suggestionKey(s)); state.pending.add(s.id); }
  for (const id of removed) { state.sent.delete(id); }
  if (added.length > 0) {
    review.suggestions.add(added)
      .catch((error: unknown) => {
        for (const s of added) { restore(s.id); }
        void logger.error(REVIEW_MODULE, error, { action: "addSuggestions" });
      })
      .finally(() => { for (const s of added) { state.pending.delete(s.id); } });
  }
  if (removed.length > 0) {
    review.suggestions.remove(removed).catch((error: unknown) => {
      for (const id of removed) { restore(id); }
      void logger.error(REVIEW_MODULE, error, { action: "removeSuggestions" });
    });
  }
}

/** The records the list stands for: the editor's own where the list holds what it sent, plus the records not sent yet or still in flight. */
function mergeSuggestions(list: readonly FileSuggestion[], local: ReadonlyMap<string, TrackedChange>, state: SendState, fileText: string, length: number): TrackedChange[] {
  const incoming = new Set(list.map((s) => s.id));
  const next: TrackedChange[] = [];
  for (const s of list) {
    const mine = local.get(s.id);
    // The port's copy of what this editor sent: the local record may have grown since, so it stays.
    if (mine && state.sent.get(s.id) === suggestionKey(s)) { next.push(mine); continue; }
    const record = toTrackedChange(s, fileText, length);
    if (record) { next.push(record); }
  }
  // Records not sent yet, or whose add is still in flight, are missing from the list but not gone.
  for (const change of local.values()) {
    if (!incoming.has(change.id) && (!state.sent.has(change.id) || state.pending.has(change.id))) { next.push(change); }
  }
  return next;
}

interface SuggestionSync {
  readonly loading: boolean;
  /** Sends the records added or changed since the last send, and the removal of those gone. */
  send(): void;
  /** Sends the removal of the sent suggestions the state does not hold. */
  sendRemovals(state: EditorState): void;
  load(list: readonly FileSuggestion[]): void;
}

/** The sync of the editor's records with the port's list. */
function createSuggestionSync(review: EditorReview, tracking: ReviewTracking, deps: Pick<ReviewSupportDeps, "lineBreak" | "savedText" | "logger">, getView: () => EditorView | undefined): SuggestionSync {
  // INVARIANT: sent holds, by id, the version of each suggestion the port has or is being sent; pending, the ids whose add is in flight.
  const state: SendState = { sent: new Map(), pending: new Set() };
  let loading = false;
  const push = (added: readonly FileSuggestion[], removed: readonly string[]): void => pushSuggestions(review, deps.logger, state, added, removed);
  const goneFrom = (ids: ReadonlySet<string>): string[] => [...state.sent.keys()].filter((id) => !ids.has(id));

  const send = (): void => {
    const view = getView();
    if (!view) { return; }
    const { doc } = view.state;
    const current = tracking.changes(view.state).map((change) => toFileSuggestion(change, doc, deps.lineBreak));
    push(current.filter((s) => state.sent.get(s.id) !== suggestionKey(s)), goneFrom(new Set(current.map((s) => s.id))));
  };

  const load = (list: readonly FileSuggestion[]): void => {
    const view = getView();
    if (!view) { return; }
    const local = new Map(tracking.changes(view.state).map((change) => [change.id, change]));
    const next = mergeSuggestions(list, local, state, deps.savedText(), view.state.doc.length);
    const incoming = new Set(list.map((s) => s.id));
    const inFlight = [...state.pending].flatMap((id): [string, string][] => { const key = state.sent.get(id); return key === undefined || incoming.has(id) ? [] : [[id, key]]; });
    state.sent = new Map([...list.map((s): [string, string] => [s.id, suggestionKey(s)]), ...inFlight]);
    loading = true;
    try { tracking.load(view, next); } finally { loading = false; }
  };

  return {
    get loading() { return loading; },
    send,
    sendRemovals: (editor) => push([], goneFrom(new Set(tracking.changes(editor).map((change) => change.id)))),
    load,
  };
}

export function createReviewSupport(review: EditorReview, { lineBreak, savedText, shared, logger }: ReviewSupportDeps): ReviewSupport {
  const tracking = createReviewTracking({ author: review.author });
  const reviewView = createReviewView(tracking);
  let view: EditorView | undefined;
  let mode = review.mode;
  const sync = createSuggestionSync(review, tracking, { lineBreak, savedText, logger }, () => view);
  const sharedSend = createDebouncer(sync.send, AUTO_SAVE_DELAY_MS);

  // An accept changes no text, so its remove goes at once; an edit or a reject waits for the save of its text.
  const listener = EditorView.updateListener.of((update) => {
    if (sync.loading || tracking.changes(update.startState) === tracking.changes(update.state)) { return; }
    if (update.docChanged) { if (shared) { sharedSend.call(); } return; }
    sync.sendRemovals(update.state);
  });

  const setMode = (next: ReviewMode): void => {
    mode = next;
    if (view) { reviewView.setMode(view, next); }
  };

  const pick = (next: ReviewMode): void => { setMode(next); review.onMode?.(next); };

  return {
    extensions: [tracking.extension, reviewView.extension, listener],
    attach(editorView) {
      view = editorView;
      if (mode !== "editing") { reviewView.setMode(editorView, mode); }
      const stop = review.suggestions.subscribe(sync.load);
      // The view stays set: closing the editor saves after this, and that save still sends.
      return () => {
        stop();
        if (shared) { sharedSend.cancel(); sync.send(); }
      };
    },
    saved: sync.send,
    setMode,
    toggle: () => pick(mode === "reviewing" ? "editing" : "reviewing"),
    dropdown: reviewModeDropdown(() => mode, pick),
  };
}
