// The editor a comment body is typed in, and the Add comment popover: a note-like card beside the selection with the quoted passage, the body and Cancel / Comment.
import type { EditorView } from "@codemirror/view";
import { mountQmdEditor, type QmdEditorHandle, type QmdEditorOptions } from "../../qmd/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { renderElement } from "../../ui/dom/index.js";
import type { TextRange } from "../comments.js";

/** mountQmdEditor reports an edit 300 ms after the last one and cannot be flushed, so a body read right after typing waits this long. */
const CHANGE_SETTLE_MS = 350;
/** The gap between the selection and the popover, and the popover and the window's edges. */
const GAP = 8;

export interface BodyInput {
  editor: QmdEditorHandle;
  /** The body as typed, once the editor has reported the last edit. */
  body(): Promise<string>;
}

/** Mounts the editor a comment body is typed in; the host may pass its own, which defaults to core's qmd editor. A comment is text and math only (`blocks: "text"`). */
export type MountBodyEditor = (root: HTMLElement, options: Pick<QmdEditorOptions, "body" | "onChange" | "blocks">) => QmdEditorHandle;

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
  const editor = mountEditor(host, { body: "", blocks: "text", onChange: (value) => { body = value; dirty = false; } });
  return {
    editor,
    async body() {
      if (dirty) { await new Promise((resolve) => setTimeout(resolve, CHANGE_SETTLE_MS)); }
      return body;
    },
  };
}

/** Where the selection ends on screen; null when the editor cannot measure it (not laid out yet, or a DOM without layout). */
function selectionCoords(view: EditorView, range: TextRange): { left: number; top: number; bottom: number } | null {
  try { return view.coordsAtPos(range.end) ?? view.coordsAtPos(range.start); } catch { return null; }
}

/** Places `card` under the selection's end, or above it when there is no room below, inside the window. */
function placeBeside(card: HTMLElement, view: EditorView, range: TextRange): void {
  const at = selectionCoords(view, range);
  const box = card.getBoundingClientRect();
  const below = (at?.bottom ?? 64) + GAP;
  const top = below + box.height > window.innerHeight - GAP && at ? at.top - box.height - GAP : below;
  const left = at?.left ?? (window.innerWidth - box.width) / 2;
  card.style.top = `${Math.max(GAP, Math.min(top, window.innerHeight - box.height - GAP))}px`;
  card.style.left = `${Math.max(GAP, Math.min(left, window.innerWidth - box.width - GAP))}px`;
}

/**
 * Opens the Add comment popover beside `range` of `view`; resolves the typed comment, or undefined when it is dismissed. Escape, Cancel and the close
 * icon dismiss it; a click outside dismisses it only while nothing is typed, so a stray click does not lose a comment.
 */
export function askCommentBody(view: EditorView, range: TextRange, mountEditor: MountBodyEditor | undefined): Promise<string | undefined> {
  return new Promise((resolve) => {
    const host = renderElement("div", { class: "ls-comment-editor" });
    const error = renderElement("p", { class: "ls-comment-status", role: "alert" });
    const close = renderElement("button", { class: "ls-btn ls-btn-ghost ls-note-popover-close", type: "button", "aria-label": "Close", title: "Close", html: renderIcon("x") });
    const cancel = renderElement("button", { class: "ls-btn ls-btn-ghost", type: "button", text: "Cancel" });
    const send = renderElement("button", { class: "ls-btn ls-btn-primary", type: "button", text: "Comment" });
    const quote = view.state.sliceDoc(range.start, range.end).trim();
    const card = renderElement("section", { class: "ls-note-popover", role: "dialog", "aria-label": "Add comment" },
      renderElement("header", { class: "ls-note-popover-head" }, renderElement("span", { class: "ls-note-popover-title" }, "Comment"), close),
      quote ? renderElement("blockquote", { class: "ls-note-popover-quote", title: quote }, quote) : null,
      renderElement("div", { class: "ls-note-popover-body" }, host),
      renderElement("footer", { class: "ls-note-popover-foot" }, error, cancel, send));
    let settled = false;
    let submitting = false;
    let typed = false;
    const place = (): void => placeBeside(card, view, range);
    const onOutside = (event: PointerEvent): void => {
      if (!typed && event.target instanceof Element && !card.contains(event.target) && !event.target.closest(".ls-menu, .ls-quick, .ls-dialog")) dismiss();
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
    const dismiss = (): void => settle(undefined);
    const submit = async (): Promise<void> => {
      if (submitting) return;
      submitting = true;
      const text = (await input.body()).trim();
      submitting = false;
      if (text === "") { error.textContent = "Write a comment"; input.editor.focus(); return; }
      settle(text);
    };
    const input = mountBodyInput(host, { onSubmit: () => void submit(), onCancel: dismiss }, mountEditor);
    host.addEventListener("input", () => { typed = true; error.textContent = ""; }, true);
    close.addEventListener("click", dismiss);
    cancel.addEventListener("click", dismiss);
    send.addEventListener("click", () => void submit());
    card.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); } });
    document.body.append(card);
    document.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("resize", place);
    view.scrollDOM.addEventListener("scroll", place, { passive: true });
    place();
    input.editor.focus();
  });
}
