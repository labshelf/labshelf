// Marks the commented ranges of an editor, shows the comment gutter and the host's footer, and opens the Add comment popover on a selection.
// CONTRACT: documents/contracts/collaboration.md#comments
import { type Extension, Prec, RangeSet, StateEffect, StateField, type Text } from "@codemirror/state";
import { EditorView, keymap, showPanel, Decoration, gutter, GutterMarker } from "@codemirror/view";
import type { ILogger } from "../../ports/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { renderElement } from "../../ui/dom/index.js";
import { showToast } from "../../ui/dom/widgets/index.js";
import { formatRelativeTime } from "../../time/index.js";
import { toggleLinePopover } from "../../ui/dom/index.js";
import type { TextRange, ThreadRange } from "../comments.js";
import { askCommentBody, type MountBodyEditor } from "./commentPopover.js";

/** The document offset of `offset` in the file text `readFileText`. */
export function fileOffsetToDoc(fileText: string, offset: number): number {
  if (!fileText.includes("\r\n")) return offset;
  const before = fileText.slice(0, offset);
  return offset - (before.match(/\r\n/g)?.length ?? 0);
}

/** The file offset of document offset `offset`, for a file whose line break is `lineBreak`. */
export function docOffsetToFile(doc: Text, lineBreak: string, offset: number): number {
  return lineBreak === "\r\n" ? offset + doc.lineAt(offset).number - 1 : offset;
}

interface CommentMarks {
  extension: Extension;
  /** Replaces the marked threads, their ranges in document offsets. */
  setRanges(view: EditorView, ranges: readonly ThreadRange[]): void;
}

const replaceRanges = StateEffect.define<readonly ThreadRange[]>();

// INVARIANT: ranges are kept in document offsets; an edit that deletes a range leaves it empty and it is not drawn.
const rangesField = StateField.define<readonly ThreadRange[]>({
  create: () => [],
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(replaceRanges)) return effect.value;
    if (!transaction.docChanged) return value;
    return value.map((range) => ({ ...range, start: transaction.changes.mapPos(range.start, 1), end: transaction.changes.mapPos(range.end, -1) }));
  },
});

/** "1 comment thread", "3 comment threads". */
const threadsLabel = (count: number): string => `${count} comment thread${count === 1 ? "" : "s"}`;

const QUOTE_CHARS = 60;

/** The start of the text a thread is on, on one line and cut short, so threads of one line tell apart. */
function quoteOf(doc: Text, thread: ThreadRange): string {
  const text = doc.sliceString(Math.max(0, thread.start), Math.min(doc.length, thread.end)).replace(/\s+/g, " ").trim();
  return text.length <= QUOTE_CHARS ? text : `${text.slice(0, QUOTE_CHARS).trimEnd()}…`;
}

/** One thread in the popover: the text it is on, then each comment's author, when and body, oldest first. */
function renderThread(doc: Text, thread: ThreadRange): HTMLElement {
  const quote = quoteOf(doc, thread);
  return renderElement("section", { class: "ls-comment-popover-thread" },
    ...(quote === "" ? [] : [renderElement("div", { class: "ls-comment-popover-quote", text: quote })]),
    ...thread.comments.map((comment) =>
      renderElement("div", { class: "ls-comment-popover-comment" },
        renderElement("div", { class: "ls-comment-popover-head" },
          renderElement("strong", { text: comment.author }), renderElement("span", { text: formatRelativeTime(comment.createdAt) })),
        renderElement("div", { class: "ls-comment-popover-body", text: comment.body }))));
}

/** The one marker of a commented line, whatever number of threads start on it; the count shows from two. */
class CommentMarker extends GutterMarker {
  constructor(private readonly threads: readonly ThreadRange[], private readonly open: () => void) { super(); }
  eq(other: GutterMarker): boolean {
    return other instanceof CommentMarker && other.open === this.open && other.threads.length === this.threads.length
      && other.threads.every((thread, i) => thread.id === this.threads[i]!.id && thread.comments.length === this.threads[i]!.comments.length
        && thread.comments.every((comment, j) => comment.body === this.threads[i]!.comments[j]!.body));
  }
  toDOM(view: EditorView): HTMLElement {
    const label = threadsLabel(this.threads.length);
    const button = document.createElement("button");
    button.className = "ls-comment-marker";
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = renderIcon("message");
    if (this.threads.length > 1) button.append(renderElement("span", { class: "ls-comment-count", text: String(this.threads.length) }));
    button.addEventListener("click", () => toggleLinePopover({
      host: view.dom, anchor: button, className: "ls-comment-popover", label, fallbackFocus: view.contentDOM, place: "beside",
      render: (close) => {
        const openAll = renderElement("button", { type: "button", class: "ls-btn ls-comment-popover-open", text: "Open in Comments" });
        openAll.addEventListener("click", () => { close(); this.open(); });
        // The marker's own copies may predate edits that eq() let it keep, so the threads are read again where they are now.
        const ids = new Set(this.threads.map((thread) => thread.id));
        const threads = view.state.field(rangesField).filter((thread) => ids.has(thread.id));
        return [...threads.map((thread) => renderThread(view.state.doc, thread)), openAll];
      },
    }));
    return button;
  }
}

/** The threads by the start of the line they start on, in document order. */
export function groupThreadsByLine(doc: Text, ranges: readonly ThreadRange[]): Map<number, ThreadRange[]> {
  const lines = new Map<number, ThreadRange[]>();
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const from = doc.lineAt(range.start).from;
    lines.set(from, [...(lines.get(from) ?? []), range]);
  }
  return lines;
}

const rangeMark = Decoration.mark({ class: "ls-comment-range" });

function commentMarks(open: () => void): CommentMarks {
  const visible = (state: EditorView["state"]): ThreadRange[] =>
    state.field(rangesField).filter((range) => range.end > range.start && range.start >= 0 && range.end <= state.doc.length);
  const decorations = EditorView.decorations.compute([rangesField], (state) =>
    Decoration.set(visible(state).map((range) => rangeMark.range(range.start, range.end)), true));
  const markerGutter = gutter({
    class: "ls-comment-gutter",
    markers: (view) => RangeSet.of([...groupThreadsByLine(view.state.doc, visible(view.state))].map(([from, threads]) => new CommentMarker(threads, open).range(from)), true),
  });
  return {
    extension: [rangesField, decorations, markerGutter],
    setRanges: (view, ranges) => view.dispatch({ effects: replaceRanges.of(ranges) }),
  };
}

/** Builds the editor's footer; the host passes its own so core does not depend on the library UI. */
export type RenderCommentFooter = () => { dom: HTMLElement; destroy(): void };

/**
 * The Add comment keys on the selection, and the host's footer when it gives one; the button lives in the selection popup.
 * @param add receives the selection in document offsets.
 */
export function addCommentSupport(add: (range: TextRange) => void, renderFooter?: RenderCommentFooter): Extension {
  const run = (view: EditorView): boolean => {
    const { from, to, empty } = view.state.selection.main;
    if (empty) return false;
    add({ start: from, end: to });
    return true;
  };
  const keys = Prec.high(keymap.of([{ key: "Mod-Alt-m", run }, { key: "Mod-Shift-c", run }]));
  return renderFooter ? [keys, showPanel.of(() => renderFooter())] : [keys];
}

const EDITOR_MODULE = "editor.comments";

/** What the editor needs from the comment threads of its file; ranges are offsets in the saved file text. */
export interface EditorComments {
  /** The listener runs with the file's unresolved threads, each with its range, now and after each change. */
  subscribe(listener: (ranges: ThreadRange[]) => void): () => void;
  add(range: TextRange, text: string): Promise<void>;
  /** Opens the comments tab. */
  open(): void;
}

export interface CommentSupportDeps {
  comments: EditorComments;
  lineBreak: string;
  /** The text last written to the file. */
  savedText(): string;
  /** Saves pending edits; resolves whether the file is saved afterwards. */
  flush(): Promise<boolean>;
  logger: ILogger;
  /** The host's footer under the editor; no footer when absent. */
  renderFooter?: RenderCommentFooter;
  /** The editor the Add comment dialog mounts for the body; core's qmd editor when absent. */
  mountEditor?: MountBodyEditor;
}

export interface CommentSupport {
  extensions: Extension[];
  /** Opens the Add comment popover on a range in document offsets, quoting its text unless `quote` is false. */
  add(range: TextRange, quote?: boolean): void;
  /** Starts following the file's threads; returns the stop function. */
  attach(view: EditorView): () => void;
}

export function createCommentSupport(deps: CommentSupportDeps): CommentSupport {
  const { comments, logger } = deps;
  let view: EditorView | undefined;
  // The saved file is what the store anchors the thread in, so the edits are written before the offsets are read.
  const addOnSelection = async (range: TextRange, quote: boolean): Promise<void> => {
    if (!view) return;
    const text = await askCommentBody(view, range, deps.mountEditor, quote);
    if (!text || !view) return;
    if (!(await deps.flush())) { showToast("Could not save the file, so the comment was not added.", "error"); return; }
    const { doc } = view.state;
    await comments.add(
      { start: docOffsetToFile(doc, deps.lineBreak, range.start), end: docOffsetToFile(doc, deps.lineBreak, range.end) }, text,
    );
  };
  // A comment on a selection quotes it; one on a block from the insert strip quotes nothing.
  const add = (range: TextRange, quote = true): void => {
    addOnSelection(range, quote).catch((error: unknown) => {
      void logger.error(EDITOR_MODULE, error, { action: "addComment" });
      showToast("Could not add the comment.", "error");
    });
  };
  const marks = commentMarks(comments.open);
  return {
    extensions: [marks.extension, addCommentSupport(add, deps.renderFooter)],
    add,
    attach(editorView) {
      view = editorView;
      return comments.subscribe((ranges) => marks.setRanges(editorView, ranges.map((range) => ({
        ...range, start: fileOffsetToDoc(deps.savedText(), range.start), end: fileOffsetToDoc(deps.savedText(), range.end),
      }))));
    },
  };
}
