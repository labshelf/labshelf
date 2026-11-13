// What a consult window over a text file adds when its surface writes: for a code file, Insert listing on a selection's bubble and Insert whole file
// in a fixed bar; for every text file, its CodeMirror view handed to the caller (the reader cites into an open manuscript window through it).
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { renderTextButton } from "../../../ui/dom/index.js";
import type { ConsultRef } from "../consultRequests.js";
import { createActionBubble, renderActionBar, type ConsultActions } from "./consultActions.js";

export interface TextWindowParts {
  /** The bar to put above the editor; undefined for a file that has no fixed actions. */
  bar: HTMLElement | undefined;
  extensions: Extension[];
  /** Shows or hides the bar for the surface's actions as they are now. */
  sync(): void;
  destroy(): void;
}

export interface TextWindowOptions {
  actions?(): ConsultActions | undefined;
  /** Gets the window's view once mounted, and undefined when it goes. */
  onView?(view: EditorView | undefined): void;
  onError?(error: unknown): void;
}

const isCode = (ref: ConsultRef): boolean => ref.kind === "code" || ref.kind === "pickedFile";

/** The 0-based lines a selection covers; a selection ending at a line's start leaves that line out. */
export function deriveSelectedLines(view: EditorView): { start: number; end: number } | undefined {
  const { from, to, empty } = view.state.selection.main;
  if (empty) return undefined;
  const { doc } = view.state;
  const first = doc.lineAt(from);
  let last = doc.lineAt(to);
  if (last.from === to && last.number > first.number) last = doc.line(last.number - 1);
  return { start: first.number - 1, end: last.number - 1 };
}

export function createTextWindowParts(ref: ConsultRef, options: TextWindowOptions): TextWindowParts {
  const lister = (): ConsultActions | undefined => {
    const actions = options.actions?.();
    return actions?.insertListing && (actions.canList?.(ref) ?? true) ? actions : undefined;
  };
  let current: EditorView | undefined;
  const capture = ViewPlugin.define((view) => {
    current = view;
    options.onView?.(view);
    return { destroy: () => { if (current === view) current = undefined; options.onView?.(undefined); } };
  });
  if (!isCode(ref)) {
    return { bar: undefined, extensions: [capture], sync: () => undefined, destroy: () => undefined };
  }

  const list = (view: EditorView, start: number, end: number): void => {
    const actions = lister();
    if (!actions?.insertListing) return;
    void actions.insertListing(ref, view.state.doc.toString(), start, end).catch((error: unknown) => options.onError?.(error));
  };
  const bubble = createActionBubble("Insert this code");
  const offer = (view: EditorView): void => {
    const lines = lister() ? deriveSelectedLines(view) : undefined;
    const at = lines && view.coordsAtPos(view.state.selection.main.head);
    if (!lines || !at) { bubble.hide(); return; }
    const label = lines.start === lines.end ? `Insert listing (line ${lines.start + 1})` : `Insert listing (lines ${lines.start + 1}-${lines.end + 1})`;
    bubble.show([[{ label, icon: "code", run: () => list(view, lines.start, lines.end) }]], { left: at.left, top: at.top, bottom: at.bottom });
  };
  // The bubble waits for the selection to settle: a released press, or a key that extends the selection.
  const settle = EditorView.domEventHandlers({
    mouseup: (_event, view) => { setTimeout(() => offer(view), 0); return false; },
    keyup: (event, view) => { if (event.shiftKey || event.key === "Shift") offer(view); return false; },
    scroll: () => { bubble.hide(); return false; },
  });

  const bar = renderActionBar();
  const whole = renderTextButton("Insert whole file", "ls-btn");
  whole.addEventListener("click", () => {
    if (current) list(current, 0, current.state.doc.lines - 1);
  });
  bar.append(whole);
  const sync = (): void => { bar.hidden = lister() === undefined; };
  sync();
  return { bar, extensions: [capture, settle], sync, destroy: () => bubble.destroy() };
}
