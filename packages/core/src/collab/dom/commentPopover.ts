// The editor a comment body is typed in, and the Add comment popover: the reader's note popover (createNotePopover) beside the selection, with the
// selected passage quoted, the note editor with its line gutter, and Cancel / Comment.
import type { EditorView } from "@codemirror/view";
import { mountQmdEditor, type QmdEditorHandle, type QmdEditorOptions } from "../../qmd/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { renderElement } from "../../ui/dom/index.js";
import { createNotePopover, type PopoverAnchor } from "../../ui/dom/widgets/index.js";
import type { TextRange } from "../comments.js";

/** mountQmdEditor reports an edit 300 ms after the last one and cannot be flushed, so a body read right after typing waits this long. */
const CHANGE_SETTLE_MS = 350;

export interface BodyInput {
  editor: QmdEditorHandle;
  /** The body as typed, once the editor has reported the last edit. */
  body(): Promise<string>;
}

/** Mounts the editor a comment body is typed in; the host may pass its own, which defaults to core's qmd editor. It gets the note's line gutter. */
export type MountBodyEditor = (root: HTMLElement, options: Pick<QmdEditorOptions, "body" | "onChange" | "gutter" | "emptyChoices">) => QmdEditorHandle;

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
  const editor = mountEditor(host, { body: "", gutter: {}, emptyChoices: false, onChange: (value) => { body = value; dirty = false; } });
  return {
    editor,
    async body() {
      if (dirty) { await new Promise((resolve) => setTimeout(resolve, CHANGE_SETTLE_MS)); }
      return body;
    },
  };
}

/** Where `pos` is on screen, as an anchor; null when the editor cannot measure it (not laid out yet, or a DOM without layout). */
function lineAnchor(view: EditorView, pos: number, side: -1 | 1): PopoverAnchor | null {
  try {
    const at = view.coordsAtPos(pos, side);
    // The card lines up with the left edge of the editor's text, not with the caret.
    return at ? { left: view.contentDOM.getBoundingClientRect().left, right: at.right, top: at.top, bottom: at.bottom } : null;
  } catch { return null; }
}

/**
 * Opens the Add comment popover under the selection's last line (over its first line when there is no room), quoting the range unless `withQuote`
 * is false. Like the reader's note it has no Comment button: closing it (the close icon, Escape, Mod-Enter or a click outside) resolves the typed
 * comment, or undefined when nothing was typed, so no comment is made.
 */
export function askCommentBody(view: EditorView, range: TextRange, mountEditor: MountBodyEditor | undefined, withQuote = true): Promise<string | undefined> {
  return new Promise((resolve) => {
    const host = renderElement("div", { class: "ls-comment-editor" });
    const close = renderElement("button", { class: "ls-btn ls-btn-ghost ls-note-popover-close", type: "button", "aria-label": "Close", title: "Close", html: renderIcon("x") });
    const quote = withQuote ? view.state.sliceDoc(range.start, range.end).trim() : "";
    const popover = createNotePopover({
      kind: "comment", title: "Comment", label: "Add comment",
      head: [renderElement("span", { class: "ls-note-popover-actions" }, close)],
    });
    const card = popover.el;
    popover.body.append(...(quote ? [renderElement("blockquote", { class: "ls-note-popover-quote", title: quote }, quote)] : []), host);
    let settled = false;
    let closing = false;
    const place = (): void => popover.place(lineAnchor(view, range.end, -1), "below", lineAnchor(view, range.start, 1));
    const onOutside = (event: PointerEvent): void => {
      if (event.target instanceof Element && !card.contains(event.target) && !event.target.closest(".ls-menu, .ls-quick, .ls-dialog")) void finish();
    };
    const settle = (value: string | undefined): void => {
      if (settled) return;
      settled = true;
      input.editor.destroy();
      card.remove();
      document.removeEventListener("pointerdown", onOutside, true);
      window.removeEventListener("resize", place);
      view.scrollDOM.removeEventListener("scroll", place);
      view.focus();
      resolve(value);
    };
    // Every way out saves what was typed; an empty body makes no comment.
    const finish = async (): Promise<void> => {
      if (closing) return;
      closing = true;
      const text = (await input.body()).trim();
      settle(text === "" ? undefined : text);
    };
    const input = mountBodyInput(host, { onSubmit: () => void finish(), onCancel: () => void finish() }, mountEditor);
    close.addEventListener("click", () => void finish());
    card.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); void finish(); } });
    document.body.append(card);
    popover.applySize();
    document.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("resize", place);
    view.scrollDOM.addEventListener("scroll", place, { passive: true });
    place();
    input.editor.focus();
    // The editor inside may lay out after the first measure; placing again keeps the card inside the window.
    requestAnimationFrame(place);
  });
}
