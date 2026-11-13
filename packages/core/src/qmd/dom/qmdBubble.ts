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

type BubbleMode = "selection" | "click";

/** The bubble mounted over one editor view; see `mountQmdBubble`. */
class QmdBubbleView implements QmdBubble {
  private readonly bubble = renderElement("div", { class: "qmd-bubble", hidden: true });
  private mode: BubbleMode | null = null;
  /** Set while a pill button runs: a selection button's own edit refreshes the pill instead of closing it. */
  private acting = false;
  private pointerDown = false;
  private readonly click = trackStillClick();
  private readonly previous: EditorView["props"]["dispatchTransaction"];

  constructor(private readonly root: HTMLElement, private readonly view: EditorView, private readonly options: QmdBubbleOptions) {
    root.append(this.bubble);
    view.dom.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    root.addEventListener("focusin", this.onFocusIn);
    root.addEventListener("focusout", this.onFocusOut);
    window.addEventListener("scroll", this.onScroll, true);
    this.previous = afterTransactions(view, this.onTransaction);
  }

  openHere = (): boolean => this.open(this.view.state.selection.empty ? "click" : "selection");

  escape = (): boolean => {
    if (this.mode === null) return false;
    this.close();
    return true;
  };

  destroy = (): void => {
    this.view.dom.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    this.root.removeEventListener("focusin", this.onFocusIn);
    this.root.removeEventListener("focusout", this.onFocusOut);
    window.removeEventListener("scroll", this.onScroll, true);
    if (!this.view.isDestroyed && this.previous) this.view.setProps({ dispatchTransaction: this.previous });
    this.bubble.remove();
  };

  private prefs(): SelectionPopupPrefs { return this.options.popup?.prefs() ?? SELECTION_ONLY; }

  private shown(choice: Choice): boolean { return !this.prefs().hidden.includes(choice.id); }

  private close(): void { this.mode = null; this.bubble.hidden = true; }

  private button(choice: Choice, state: EditorState): PillButton {
    return {
      label: choice.label, icon: choice.icon, ...(choice.shortcut ? { shortcut: shortcutLabel(choice.shortcut) } : {}),
      ...(this.mode === "selection" && choice.active ? { pressed: choice.active(state) } : {}),
      disabled: !choice.command(state),
      run: () => {
        this.acting = this.mode === "selection";
        try { runAction(this.view, choice); } finally { this.acting = false; }
        if (this.mode === "click") this.close();
      },
    };
  }

  private customize(): MenuEntry[] {
    const { popup } = this.options;
    if (!popup?.setPrefs) return [];
    const save = popup.setPrefs;
    return [{ label: "Customize popup…", icon: "gear", onSelect: () => {
      this.close();
      openSelectionPopupDialog({ title: "Customize Note Popup", prefs: popup.prefs(), groups: POPUP_GROUPS, onChange: save, view: this.view });
    } }];
  }

  /** The pill's groups now, empty when it has nothing to offer. */
  private groupsOf(state: EditorState, current: BubbleMode): { groups: PillButton[][]; entries: MenuEntry[] } {
    if (current === "click") {
      const inserts = insertsAt(state).filter((choice) => this.shown(choice) && choice.command(state)).map((choice) => this.button(choice, state));
      return { groups: [inserts], entries: inserts.length > 0 ? this.customize() : [] };
    }
    const { onOpenLink } = this.options;
    const href = this.prefs().contextual && onOpenLink ? paperLinkNear(state) : undefined;
    const contextual: PillButton[] = href && onOpenLink ? [{ label: "Open in PDF", icon: "book-open", run: () => { this.close(); onOpenLink(href); } }] : [];
    const styles = BLOCK_STYLES.filter((choice) => this.shown(choice)).map((choice): MenuEntry => ({ label: choice.label, icon: choice.icon, onSelect: () => { this.close(); runAction(this.view, choice); } }));
    const more = this.customize();
    const entries = [...styles, ...(styles.length > 0 && more.length > 0 ? ["separator" as const] : []), ...more];
    return { groups: [contextual, FORMATTING.filter((choice) => this.shown(choice)).map((choice) => this.button(choice, state))], entries };
  }

  private render(): void {
    const { view, mode } = this;
    if (mode === null || view.isDestroyed) return;
    const { groups, entries } = this.groupsOf(view.state, mode);
    const more: PillButton[] = entries.length > 0 ? [{ label: "More", icon: "more", run: (element) => showMenu(element, entries) }] : [];
    renderPillBar([...groups, more], { label: mode === "click" ? "Insert at the cursor" : "Selection actions", pill: this.bubble });
    this.bubble.hidden = false;
    placeBubble(view, this.bubble, view.state.selection.from, view.state.selection.to);
  }

  /** Opens the pill in `next` mode when the selection fits it and it has something to offer. */
  private open(next: BubbleMode): boolean {
    const { view } = this;
    const { selection } = view.state;
    if (!view.editable || view.isDestroyed || !view.dom.isConnected || inNodeEditor() || !(selection instanceof TextSelection) || selection.empty !== (next === "click")) return false;
    if (next === "click" && !this.options.popup) return false;
    const { groups, entries } = this.groupsOf(view.state, next);
    if (groups.every((group) => group.length === 0) && entries.length === 0) return false;
    this.mode = next;
    this.render();
    return true;
  }

  private readonly onTransaction = (changed: boolean): void => {
    if (!changed) return;
    if (this.acting && this.mode === "selection" && !this.view.state.selection.empty) { this.render(); return; }
    this.close();
    if (!this.pointerDown && this.prefs().trigger === "any") this.open("selection");
  };

  private onText(target: EventTarget | null): boolean {
    return target instanceof Element && this.view.dom.contains(target) && !target.closest("[contenteditable=false], button, .qmd-cell-code, .qmd-math-edit");
  }

  private readonly onMouseDown = (event: MouseEvent): void => { this.pointerDown = true; this.click.press(event, this.onText(event.target)); };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (!this.pointerDown) return;
    this.pointerDown = false;
    const still = this.click.isStill(event);
    // Wait for ProseMirror to settle the selection of this press.
    setTimeout(() => {
      if (this.view.isDestroyed) return;
      const { trigger, onClick } = this.prefs();
      if (!this.view.state.selection.empty) { if (trigger === "any" || (trigger === "mouse" && event.detail <= 1)) this.open("selection"); }
      else if (onClick && still) this.open("click");
    }, 0);
  };

  private readonly onFocusIn = (): void => { if (inNodeEditor()) this.close(); };

  private readonly onFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget as Node | null;
    if (next !== null && !this.root.contains(next)) this.close();
  };

  private readonly onScroll = (): void => {
    if (this.mode !== null && !this.view.isDestroyed) placeBubble(this.view, this.bubble, this.view.state.selection.from, this.view.state.selection.to);
  };
}

/**
 * Mounts the bubble into `root` for the editable `view`. A selection opens it as the settings' trigger says, a still click on the text opens the insertions
 * when `onClick` is on and the host passed its settings, and Mod-. opens either; Escape, an edit, a selection change, blur or a node editor's focus close it.
 * @returns the commands of its keys (Mod-. opens it, Escape closes it when open) and `destroy`.
 */
export function mountQmdBubble(root: HTMLElement, view: EditorView, options: QmdBubbleOptions): QmdBubble {
  return new QmdBubbleView(root, view, options);
}
