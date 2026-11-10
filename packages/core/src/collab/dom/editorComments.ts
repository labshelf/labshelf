// Marks the commented ranges of an editor, shows the comment gutter and the Add comment panel, and opens the Add comment popover on a selection.
// CONTRACT: documents/contracts/collaboration.md#comments
import { type Extension, Prec, RangeSet, StateEffect, StateField, type Text } from "@codemirror/state";
import { EditorView, keymap, showPanel, Decoration, gutter, GutterMarker, ViewPlugin } from "@codemirror/view";
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

/** The start of the line under the pointer, for the "+" that comments on it; null when the pointer is off the text. */
const setHoveredLine = StateEffect.define<number | null>();

const hoveredLineField = StateField.define<number | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setHoveredLine)) return effect.value;
    return value === null || !transaction.docChanged ? value : transaction.newDoc.lineAt(transaction.changes.mapPos(value)).from;
  },
});

// The pointer is followed on the scroller, so the "+" shows whether it is over the text or the gutter, as in VS Code.
const hoverTracker = ViewPlugin.define((view) => {
  const set = (line: number | null): void => { if (view.state.field(hoveredLineField) !== line) view.dispatch({ effects: setHoveredLine.of(line) }); };
  const move = (event: MouseEvent): void => {
    const block = view.lineBlockAtHeight(event.clientY - view.documentTop);
    set(event.clientY - view.documentTop > block.bottom ? null : block.from);
  };
  const leave = (): void => set(null);
  view.scrollDOM.addEventListener("mousemove", move);
  view.scrollDOM.addEventListener("mouseleave", leave);
  return { destroy() { view.scrollDOM.removeEventListener("mousemove", move); view.scrollDOM.removeEventListener("mouseleave", leave); } };
});

class AddLineMarker extends GutterMarker {
  constructor(private readonly line: TextRange, private readonly add: (range: TextRange) => void) { super(); }
  eq(other: GutterMarker): boolean { return other instanceof AddLineMarker && other.line.start === this.line.start && other.line.end === this.line.end; }
  toDOM(): HTMLElement {
    const button = document.createElement("button");
    button.className = "ls-comment-add";
    button.type = "button";
    button.title = "Comment on this line";
    button.setAttribute("aria-label", "Comment on this line");
    button.innerHTML = renderIcon("plus");
    // The line, not the click, picks the range: the pointer has left the text by now.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => this.add(this.line));
    return button;
  }
}

function commentMarks(open: () => void, add: (range: TextRange) => void): CommentMarks {
  const visible = (state: EditorView["state"]): ThreadRange[] =>
    state.field(rangesField).filter((range) => range.end > range.start && range.start >= 0 && range.end <= state.doc.length);
  const decorations = EditorView.decorations.compute([rangesField], (state) =>
    Decoration.set(visible(state).map((range) => rangeMark.range(range.start, range.end)), true));
  const markerGutter = gutter({
    class: "ls-comment-gutter",
    markers: (view) => RangeSet.of([...groupThreadsByLine(view.state.doc, visible(view.state))].map(([from, threads]) => new CommentMarker(threads, open).range(from)), true),
    // A commented line shows its own marker. A thread needs a non-empty quote, so a blank line anchors on its line break; the last line has none when blank.
    lineMarker(view, block) {
      if (view.state.field(hoveredLineField) !== block.from) return null;
      const { doc } = view.state;
      const line = doc.lineAt(block.from);
      if (visible(view.state).some((range) => doc.lineAt(range.start).number === line.number)) return null;
      const text = line.text.trim();
      if (text === "") return line.to < doc.length ? new AddLineMarker({ start: line.to, end: line.to + 1 }, add) : null;
      const start = line.from + line.text.indexOf(text);
      return new AddLineMarker({ start, end: start + text.length }, add);
    },
    lineMarkerChange: (update) => update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setHoveredLine))),
  });
  return {
    extension: [rangesField, hoveredLineField, hoverTracker, decorations, markerGutter],
    setRanges: (view, ranges) => view.dispatch({ effects: replaceRanges.of(ranges) }),
  };
}

/** Builds the footer around the Add comment button; the host passes its own so core does not depend on the library UI. */
export type RenderCommentFooter = (action: HTMLElement) => { dom: HTMLElement; destroy(): void };

/** @param add receives the selection in document offsets. */
export function addCommentSupport(add: (range: TextRange) => void, renderFooter?: RenderCommentFooter): Extension {
  const run = (view: EditorView): boolean => {
    const { from, to, empty } = view.state.selection.main;
    if (empty) return false;
    add({ start: from, end: to });
    return true;
  };
  const panel = showPanel.of((view) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ls-btn ls-add-comment";
    button.innerHTML = `${renderIcon("message")}Add comment`;
    button.title = "Add comment on the selection (Ctrl/Cmd+Shift+C or Ctrl/Cmd+Alt+M)";
    button.disabled = view.state.selection.main.empty;
    button.addEventListener("click", () => run(view));
    const footer = renderFooter?.(button) ?? { dom: button, destroy(): void {} };
    return { ...footer, update: (update) => { button.disabled = update.state.selection.main.empty; } };
  });
  return [Prec.high(keymap.of([{ key: "Mod-Alt-m", run }, { key: "Mod-Shift-c", run }])), panel];
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
  /** Wraps the Add comment button in the host's footer; the button stands alone when absent. */
  renderFooter?: RenderCommentFooter;
  /** The editor the Add comment dialog mounts for the body; core's qmd editor when absent. */
  mountEditor?: MountBodyEditor;
}

export interface CommentSupport {
  extensions: Extension[];
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
  // A comment on a selection quotes it; one from a line's gutter '+' quotes nothing.
  const add = (range: TextRange, quote = true): void => {
    addOnSelection(range, quote).catch((error: unknown) => {
      void logger.error(EDITOR_MODULE, error, { action: "addComment" });
      showToast("Could not add the comment.", "error");
    });
  };
  const marks = commentMarks(comments.open, (range) => add(range, false));
  return {
    extensions: [marks.extension, addCommentSupport(add, deps.renderFooter)],
    attach(editorView) {
      view = editorView;
      return comments.subscribe((ranges) => marks.setRanges(editorView, ranges.map((range) => ({
        ...range, start: fileOffsetToDoc(deps.savedText(), range.start), end: fileOffsetToDoc(deps.savedText(), range.end),
      }))));
    },
  };
}
