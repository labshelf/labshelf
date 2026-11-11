// The notes editor's bubble, in the pill every text bubble shares: on a text selection, Open in PDF for a quoted passage, formatting and an overflow menu of
// block styles; on a still single click, the structures that fit where the caret landed (inline marks mid-paragraph, blocks on an empty line, a row or column in a table).
import type { Node as ProseNode } from "prosemirror-model";
import { TextSelection, type Command, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { renderElement, renderPillBar, showMenu, trackStillClick, type MenuEntry, type PillButton } from "../../ui/dom/index.js";
import type { IconName } from "../../ui/icons/index.js";
import { DEFAULT_NOTE_POPUP, type SelectionPopupPrefs } from "../../writing/selectionPopup/prefs.js";
import { openSelectionPopupDialog, type PopupButtonGroup } from "../../writing/dom/sourceEditor/selectionPopupDialog.js";
import { parsePaperLink } from "../../library/index.js";
import { qmdSchema } from "../editor/index.js";
import { QMD_ACTIONS, QMD_HEADINGS, shortcutLabel, type QmdAction } from "./qmdCommands.js";
import { runAction } from "./qmdControls.js";
import { addColumnRight, addRowBelow } from "./tableCommands.js";

/** The bubble's settings and, with `setPrefs`, the Customize entry that changes them; an editor without it shows the selection's formatting only. */
export interface QmdPopupOptions { prefs(): SelectionPopupPrefs; setPrefs?(next: SelectionPopupPrefs): void }

interface Choice { id: string; label: string; icon: IconName; command: Command; shortcut?: string; active?: (state: EditorState) => boolean }

const fromAction = (action: QmdAction, id = action.id, label = action.label): Choice =>
  ({ id, label, icon: action.icon, command: action.command, shortcut: action.shortcut, ...(action.active ? { active: action.active } : {}) });

const FORMATTING: readonly Choice[] = (["bold", "italic", "inlineMath", "inlineCode", "link"] as const).map((id) => fromAction(QMD_ACTIONS[id]));
const BLOCK_STYLES: readonly Choice[] = [
  ...[1, 2, 3, 0].map((level) => {
    const heading = QMD_HEADINGS.find((entry) => entry.level === level)!;
    return { id: level === 0 ? "paragraph" : `heading${level}`, label: heading.label, icon: (level === 0 ? "text-box" : "heading") as IconName, command: heading.command, shortcut: heading.shortcut };
  }),
  ...(["bullet", "ordered", "task"] as const).map((id) => fromAction(QMD_ACTIONS[id])),
];
const heading2 = QMD_HEADINGS.find((entry) => entry.level === 2)!;
const INSERTS = {
  inline: [fromAction(QMD_ACTIONS.inlineMath, "insertMath"), fromAction(QMD_ACTIONS.link, "insertLink")],
  emptyLine: [
    { id: "insertHeading", label: "Heading", icon: "heading", command: heading2.command, shortcut: heading2.shortcut },
    fromAction(QMD_ACTIONS.bullet, "insertList"),
    fromAction(QMD_ACTIONS.task, "insertTask"),
    fromAction(QMD_ACTIONS.displayMath, "insertDisplayMath"),
    fromAction(QMD_ACTIONS.codeCell, "insertCodeCell"),
    fromAction(QMD_ACTIONS.table, "insertTable"),
    fromAction(QMD_ACTIONS.figure, "insertFigure"),
  ],
  table: [
    { id: "addRow", label: "Add row below", icon: "plus", command: addRowBelow },
    { id: "addColumn", label: "Add column right", icon: "plus", command: addColumnRight },
  ],
} satisfies Record<string, readonly Choice[]>;

/** The buttons the Customize dialog lets the user hide. */
const POPUP_GROUPS: readonly PopupButtonGroup[] = [
  { heading: "Selection", buttons: [...FORMATTING, ...BLOCK_STYLES] },
  { heading: "Insert", buttons: [...INSERTS.inline, ...INSERTS.emptyLine, ...INSERTS.table] },
];

/** Without a host's settings: the formatting of a selection, on any selection, as comments and discussions always had it. */
const SELECTION_ONLY: SelectionPopupPrefs = { ...DEFAULT_NOTE_POPUP, onClick: false };
const GAP = 6;
const MARGIN = 8;

/** Whether the focus is in a node's own editor, such as a cell's code or an equation's LaTeX field. */
const inNodeEditor = (): boolean => document.activeElement?.closest?.(".qmd-cell-code, .qmd-math-edit") != null;

/** The first link to a paper (`labshelf:` href) from `from` to `to`. */
function paperLinkIn(doc: ProseNode, from: number, to: number): string | undefined {
  let href: string | undefined;
  doc.nodesBetween(from, to, (node) => {
    const link = href === undefined ? node.marks.find((mark) => mark.type === qmdSchema.marks.link && parsePaperLink(String(mark.attrs.href)) !== undefined) : undefined;
    if (link) href = link.attrs.href as string;
    return href === undefined;
  });
  return href;
}

/** The paper a selection quotes: a paper link in the selection, else in its block, else in the block after it, where sendTo puts the link under a quote. */
function paperLinkNear(state: EditorState): string | undefined {
  const { from, to, $from } = state.selection;
  if ($from.depth < 1) return paperLinkIn(state.doc, from, to);
  const start = $from.before(1);
  const block = state.doc.child($from.index(0));
  const next = start + block.nodeSize;
  return paperLinkIn(state.doc, from, to) ?? paperLinkIn(state.doc, start, next) ?? (next < state.doc.content.size ? paperLinkIn(state.doc, next, next + state.doc.child($from.index(0) + 1).nodeSize) : undefined);
}

/** Where a caret placed by a click is, for its insertions: in a table cell, on an empty line, or inside text. */
function insertsAt(state: EditorState): readonly Choice[] {
  const { $from } = state.selection;
  const { parent } = $from;
  if (parent.type === qmdSchema.nodes.table_cell || parent.type === qmdSchema.nodes.table_header) return INSERTS.table;
  if (!parent.isTextblock) return [];
  return parent.content.size === 0 && parent.type === qmdSchema.nodes.paragraph ? INSERTS.emptyLine : INSERTS.inline;
}

/** Centres the bubble over `from`..`to`, or under it when there is no room above, kept inside the window. */
function placeBubble(view: EditorView, bubble: HTMLElement, from: number, to: number): void {
  let start: { left: number; top: number; bottom: number };
  let end: { left: number; top: number };
  try {
    start = view.coordsAtPos(from);
    end = view.coordsAtPos(to);
  } catch {
    return;
  }
  const { offsetWidth: width, offsetHeight: height } = bubble;
  const centre = start.top === end.top ? (start.left + end.left) / 2 : start.left + width / 2;
  const top = start.top - GAP - height >= MARGIN ? start.top - GAP - height : start.bottom + GAP;
  bubble.style.left = `${Math.max(MARGIN, Math.min(centre - width / 2, window.innerWidth - width - MARGIN))}px`;
  bubble.style.top = `${Math.max(MARGIN, top)}px`;
}

/** Calls `after` with each transaction `view` dispatches once it is applied; returns the dispatcher it replaced, to restore. */
function afterTransactions(view: EditorView, after: (docOrSelectionChanged: boolean) => void): EditorView["props"]["dispatchTransaction"] {
  const previous = view.props.dispatchTransaction;
  view.setProps({
    dispatchTransaction(tr) {
      if (previous) previous.call(this, tr);
      else view.updateState(view.state.apply(tr));
      after(tr.docChanged || tr.selectionSet);
    },
  });
  return previous;
}

export interface QmdBubble { openHere(): boolean; escape(): boolean; destroy(): void }

export interface QmdBubbleOptions {
  /** The note hosts' settings; without them the bubble formats selections only. */
  popup?: QmdPopupOptions;
  /** Opens a `labshelf:` link; without it there is no Open in PDF. */
  onOpenLink?(href: string): void;
}

/**
 * Mounts the bubble into `root` for the editable `view`. A selection opens it as the settings' trigger says, a still click on the text opens the insertions
 * when `onClick` is on and the host passed its settings, and Mod-. opens either; Escape, an edit, a selection change, blur or a node editor's focus close it.
 * @returns the commands of its keys (Mod-. opens it, Escape closes it when open) and `destroy`.
 */
export function mountQmdBubble(root: HTMLElement, view: EditorView, options: QmdBubbleOptions): QmdBubble {
  const bubble = renderElement("div", { class: "qmd-bubble", hidden: true });
  root.append(bubble);
  const prefs = (): SelectionPopupPrefs => options.popup?.prefs() ?? SELECTION_ONLY;
  const shown = (choice: Choice): boolean => !prefs().hidden.includes(choice.id);
  let mode: "selection" | "click" | null = null;
  /** Set while a pill button runs: a selection button's own edit refreshes the pill instead of closing it. */
  let acting = false;
  let pointerDown = false;
  const click = trackStillClick();

  const close = (): void => { mode = null; bubble.hidden = true; };
  const button = (choice: Choice, state: EditorState): PillButton => ({
    label: choice.label, icon: choice.icon, ...(choice.shortcut ? { shortcut: shortcutLabel(choice.shortcut) } : {}),
    ...(mode === "selection" && choice.active ? { pressed: choice.active(state) } : {}),
    disabled: !choice.command(state),
    run: () => {
      acting = mode === "selection";
      try { runAction(view, choice); } finally { acting = false; }
      if (mode === "click") close();
    },
  });
  const customize = (): MenuEntry[] => {
    const { popup } = options;
    if (!popup?.setPrefs) return [];
    const save = popup.setPrefs;
    return [{ label: "Customize popup…", icon: "gear", onSelect: () => {
      close();
      openSelectionPopupDialog({ title: "Customize Note Popup", prefs: popup.prefs(), groups: POPUP_GROUPS, onChange: save, view });
    } }];
  };

  /** The pill's groups now, empty when it has nothing to offer. */
  function groupsOf(state: EditorState, current: "selection" | "click"): { groups: PillButton[][]; entries: MenuEntry[] } {
    if (current === "click") {
      const inserts = insertsAt(state).filter((choice) => shown(choice) && choice.command(state)).map((choice) => button(choice, state));
      return { groups: [inserts], entries: inserts.length > 0 ? customize() : [] };
    }
    const href = prefs().contextual && options.onOpenLink ? paperLinkNear(state) : undefined;
    const contextual: PillButton[] = href ? [{ label: "Open in PDF", icon: "book-open", run: () => { close(); options.onOpenLink!(href); } }] : [];
    const styles = BLOCK_STYLES.filter(shown).map((choice): MenuEntry => ({ label: choice.label, icon: choice.icon, onSelect: () => { close(); runAction(view, choice); } }));
    const more = customize();
    const entries = [...styles, ...(styles.length > 0 && more.length > 0 ? ["separator" as const] : []), ...more];
    return { groups: [contextual, FORMATTING.filter(shown).map((choice) => button(choice, state))], entries };
  }

  function render(): void {
    if (mode === null || view.isDestroyed) return;
    const { groups, entries } = groupsOf(view.state, mode);
    const more: PillButton[] = entries.length > 0 ? [{ label: "More", icon: "more", run: (element) => showMenu(element, entries) }] : [];
    renderPillBar([...groups, more], { label: mode === "click" ? "Insert at the cursor" : "Selection actions", pill: bubble });
    bubble.hidden = false;
    placeBubble(view, bubble, view.state.selection.from, view.state.selection.to);
  }

  /** Opens the pill in `next` mode when the selection fits it and it has something to offer. */
  function open(next: "selection" | "click"): boolean {
    const { selection } = view.state;
    if (!view.editable || view.isDestroyed || !view.dom.isConnected || inNodeEditor() || !(selection instanceof TextSelection) || selection.empty !== (next === "click")) return false;
    if (next === "click" && !options.popup) return false;
    const { groups, entries } = groupsOf(view.state, next);
    if (groups.every((group) => group.length === 0) && entries.length === 0) return false;
    mode = next;
    render();
    return true;
  }

  const openHere = (): boolean => open(view.state.selection.empty ? "click" : "selection");
  const onTransaction = (changed: boolean): void => {
    if (!changed) return;
    if (acting && mode === "selection" && !view.state.selection.empty) { render(); return; }
    close();
    if (!pointerDown && prefs().trigger === "any") open("selection");
  };
  const onText = (target: EventTarget | null): boolean =>
    target instanceof Element && view.dom.contains(target) && !target.closest("[contenteditable=false], button, .qmd-cell-code, .qmd-math-edit");
  const onMouseDown = (event: MouseEvent): void => { pointerDown = true; click.press(event, onText(event.target)); };
  const onMouseUp = (event: MouseEvent): void => {
    if (!pointerDown) return;
    pointerDown = false;
    const still = click.isStill(event);
    // Wait for ProseMirror to settle the selection of this press.
    setTimeout(() => {
      if (view.isDestroyed) return;
      const { trigger, onClick } = prefs();
      if (!view.state.selection.empty) { if (trigger === "any" || (trigger === "mouse" && event.detail <= 1)) open("selection"); }
      else if (onClick && still) open("click");
    }, 0);
  };
  const onFocusIn = (): void => { if (inNodeEditor()) close(); };
  const onFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget as Node | null;
    if (next !== null && !root.contains(next)) close();
  };
  const onScroll = (): void => { if (mode !== null && !view.isDestroyed) placeBubble(view, bubble, view.state.selection.from, view.state.selection.to); };
  view.dom.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  window.addEventListener("scroll", onScroll, true);
  const previous = afterTransactions(view, onTransaction);

  return {
    openHere,
    escape: () => { if (mode === null) return false; close(); return true; },
    destroy() {
      view.dom.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("scroll", onScroll, true);
      if (!view.isDestroyed && previous) view.setProps({ dispatchTransaction: previous });
      bubble.remove();
    },
  };
}
