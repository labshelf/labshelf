// Marks the commented ranges of an editor, shows the comment gutter and the Add comment panel, and mounts the editor a comment body is typed in.
// CONTRACT: documents/contracts/collaboration.md#comments
import { type Extension, Prec, RangeSet, StateEffect, StateField, type Text } from "@codemirror/state";
import { EditorView, keymap, showPanel, Decoration, gutter, GutterMarker } from "@codemirror/view";
import type { ILogger } from "../../ports/index.js";
import { mountQmdEditor, type QmdEditorHandle } from "../../qmd/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { renderElement } from "../../ui/dom/index.js";
import { mountFormDialog, showToast } from "../../ui/dom/widgets/index.js";
import type { TextRange } from "../comments.js";

/** mountQmdEditor reports an edit 300 ms after the last one and cannot be flushed, so a body read right after typing waits this long. */
const CHANGE_SETTLE_MS = 350;

/** The document offset of `offset` in the file text `readFileText`. */
function fileOffsetToDoc(fileText: string, offset: number): number {
  if (!fileText.includes("\r\n")) return offset;
  const before = fileText.slice(0, offset);
  return offset - (before.match(/\r\n/g)?.length ?? 0);
}

/** The file offset of document offset `offset`, for a file whose line break is `lineBreak`. */
function docOffsetToFile(doc: Text, lineBreak: string, offset: number): number {
  return lineBreak === "\r\n" ? offset + doc.lineAt(offset).number - 1 : offset;
}

interface CommentMarks {
  extension: Extension;
  /** Replaces the marked ranges, given in document offsets. */
  setRanges(view: EditorView, ranges: readonly TextRange[]): void;
}

const replaceRanges = StateEffect.define<readonly TextRange[]>();

// INVARIANT: ranges are kept in document offsets; an edit that deletes a range leaves it empty and it is not drawn.
const rangesField = StateField.define<readonly TextRange[]>({
  create: () => [],
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(replaceRanges)) return effect.value;
    if (!transaction.docChanged) return value;
    return value.map((range) => ({ start: transaction.changes.mapPos(range.start, 1), end: transaction.changes.mapPos(range.end, -1) }));
  },
});

class CommentMarker extends GutterMarker {
  constructor(private readonly open: () => void) { super(); }
  eq(): boolean { return true; }
  toDOM(): HTMLElement {
    const button = document.createElement("button");
    button.className = "ls-comment-marker";
    button.type = "button";
    button.title = "Open comments";
    button.setAttribute("aria-label", "Open comments");
    button.innerHTML = renderIcon("message");
    button.addEventListener("click", this.open);
    return button;
  }
}

const rangeMark = Decoration.mark({ class: "ls-comment-range" });

function commentMarks(open: () => void): CommentMarks {
  const marker = new CommentMarker(open);
  const visible = (state: EditorView["state"]): TextRange[] =>
    state.field(rangesField).filter((range) => range.end > range.start && range.start >= 0 && range.end <= state.doc.length);
  const decorations = EditorView.decorations.compute([rangesField], (state) =>
    Decoration.set(visible(state).map((range) => rangeMark.range(range.start, range.end)), true));
  const markerGutter = gutter({
    class: "ls-comment-gutter",
    markers: (view) => RangeSet.of(visible(view.state).map((range) => marker.range(view.state.doc.lineAt(range.start).from)), true),
  });
  return {
    extension: [rangesField, decorations, markerGutter],
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
    button.title = "Add comment on the selection (Ctrl/Cmd+Alt+M)";
    button.disabled = view.state.selection.main.empty;
    button.addEventListener("click", () => run(view));
    const footer = renderFooter?.(button) ?? { dom: button, destroy(): void {} };
    return { ...footer, update: (update) => { button.disabled = update.state.selection.main.empty; } };
  });
  return [Prec.high(keymap.of([{ key: "Mod-Alt-m", run }])), panel];
}

const EDITOR_MODULE = "editor.comments";

export interface BodyInput {
  editor: QmdEditorHandle;
  /** The body as typed, once the editor has reported the last edit. */
  body(): Promise<string>;
}

/** Mounts the editor a comment body is typed in; the host may pass its own, which defaults to core's qmd editor. */
export type MountBodyEditor = (root: HTMLElement, options: { body: string; onChange(value: string): void }) => QmdEditorHandle;

/** Mounts an editable core editor for a comment body in `host`; Mod-Enter calls `onSubmit` and Escape calls `onCancel`. */
export function mountBodyInput(
  host: HTMLElement, { onSubmit, onCancel }: { onSubmit(): void; onCancel?(): void }, mountEditor: MountBodyEditor = mountQmdEditor,
): BodyInput {
  let body = "";
  let dirty = false;
  const isSubmit = (event: KeyboardEvent): boolean => event.key === "Enter" && (event.metaKey || event.ctrlKey);
  host.addEventListener("input", () => { dirty = true; }, true);
  host.addEventListener("keydown", (event) => {
    if (isSubmit(event)) { event.preventDefault(); event.stopPropagation(); onSubmit(); return; }
    if (event.key === "Escape" && onCancel) { event.preventDefault(); event.stopPropagation(); onCancel(); return; }
    if (!["Control", "Meta", "Alt", "Shift", "Escape"].includes(event.key)) { dirty = true; }
  }, true);
  const editor = mountEditor(host, { body: "", onChange: (value) => { body = value; dirty = false; } });
  return {
    editor,
    async body() {
      if (dirty) { await new Promise((resolve) => setTimeout(resolve, CHANGE_SETTLE_MS)); }
      return body;
    },
  };
}

/** Opens the Add comment dialog; resolves the typed comment, or undefined when it is dismissed. */
function askCommentBody(mountEditor: MountBodyEditor | undefined): Promise<string | undefined> {
  return new Promise((resolve) => {
    const host = renderElement("div", { class: "ls-comment-editor" });
    const error = renderElement("p", { class: "ls-comment-status", role: "alert" });
    const form = renderElement("form", { class: "ls-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Add comment", novalidate: true },
      renderElement("h2", { text: "Add comment" }), host, error);
    let settled = false;
    let submitting = false;
    const submit = async (): Promise<void> => {
      if (submitting) return;
      submitting = true;
      const text = (await input.body()).trim();
      submitting = false;
      if (text === "") { error.textContent = "Write a comment"; return; }
      settle(text);
      close();
    };
    const input = mountBodyInput(host, { onSubmit: () => void submit() }, mountEditor);
    const settle = (value: string | undefined): void => {
      if (settled) return;
      settled = true;
      input.editor.destroy();
      resolve(value);
    };
    const close = mountFormDialog(form, { submitLabel: "Add comment", unsubscribe: () => settle(undefined) });
    form.addEventListener("submit", (event) => { event.preventDefault(); void submit(); });
    input.editor.focus();
  });
}

/** What the editor needs from the comment threads of its file; ranges are offsets in the saved file text. */
export interface EditorComments {
  /** The listener runs with the ranges of the file's unresolved threads now and after each change. */
  subscribe(listener: (ranges: TextRange[]) => void): () => void;
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
  const marks = commentMarks(comments.open);
  let view: EditorView | undefined;
  // The saved file is what the store anchors the thread in, so the edits are written before the offsets are read.
  const addOnSelection = async (range: TextRange): Promise<void> => {
    const text = await askCommentBody(deps.mountEditor);
    if (!text || !view) return;
    if (!(await deps.flush())) { showToast("Could not save the file, so the comment was not added.", "error"); return; }
    const { doc } = view.state;
    await comments.add(
      { start: docOffsetToFile(doc, deps.lineBreak, range.start), end: docOffsetToFile(doc, deps.lineBreak, range.end) }, text,
    );
  };
  const add = (range: TextRange): void => {
    addOnSelection(range).catch((error: unknown) => {
      void logger.error(EDITOR_MODULE, error, { action: "addComment" });
      showToast("Could not add the comment.", "error");
    });
  };
  return {
    extensions: [marks.extension, addCommentSupport(add, deps.renderFooter)],
    attach(editorView) {
      view = editorView;
      return comments.subscribe((ranges) => marks.setRanges(editorView, ranges.map((range) => ({
        start: fileOffsetToDoc(deps.savedText(), range.start), end: fileOffsetToDoc(deps.savedText(), range.end),
      }))));
    },
  };
}
