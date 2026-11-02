// Draws the visible controls of the rich Markdown editor in place of a toolbar: a small bubble of marks over a text selection, and builds the Insert panel and the block choices.
import { TextSelection, type Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { renderElement, type MenuItem, type SectionPanel, type SectionPanelItem, type SectionPanelSection } from "../../ui/dom/index.js";
import { renderIcon, type IconName } from "../../ui/icons/index.js";
import { CELL_LANGUAGES, cellLanguageLabel, type CellLanguage } from "../compute/index.js";
import { qmdSchema } from "../editor/index.js";
import { insertCodeCell, QMD_ACTIONS, QMD_HEADINGS, shortcutLabel, type QmdAction } from "./qmdCommands.js";

const BUBBLE_ACTIONS = ["bold", "italic", "inlineMath", "link"] as const;
const LIST_ACTIONS = ["bullet", "ordered", "task"] as const;
const LIST_LABELS: Record<(typeof LIST_ACTIONS)[number], string> = { bullet: "Bullets", ordered: "Numbered", task: "Tasks" };
const INLINE_ACTIONS = ["inlineMath", "link"] as const;
const GAP = 6;
const MARGIN = 8;

const runCommand = (view: EditorView, command: Command): boolean => command(view.state, view.dispatch.bind(view), view);

/** Runs `action` and gives the editor its focus back; the link command opens an input box that hands focus back itself. */
function runAction(view: EditorView, action: QmdAction): void {
  runCommand(view, action.command);
  if (action.id !== "link") view.focus();
}

/** Where an Insert panel inserts: `language` is the note's cell language, listed first; `place` puts the selection on the block before a gap
 * (each choice then adds its block after it), and without it the choices act at the caret; `source` adds Edit Markdown source. */
export interface InsertTarget { language: CellLanguage; place?: () => void; source?: () => void }

/**
 * The Insert panel, grouped like the project panel: headings, lists and the code cells as chips (a new line is already text, so text is no choice), then the equation and diagram blocks with their
 * shortcuts; at the caret also the inline marks and the Markdown source. At the caret a choice that cannot apply there is disabled.
 */
export function insertPanel(view: EditorView, { language, place, source }: InsertTarget): SectionPanel {
  const atGap = place !== undefined;
  const choose = (insert: () => void) => () => { if (view.isDestroyed) return; place?.(); insert(); view.focus(); };
  // At a gap a text style goes on a new paragraph after the block; at the caret it restyles the block the caret is in.
  const styled = (command: Command) => choose(() => { if (atGap) insertText(view); runCommand(view, command); });
  const disabled = (command: Command): { disabled?: true } => (!atGap && !command(view.state) ? { disabled: true } : {});
  const item = (label: string, icon: IconName | undefined, command: Command, run: () => void, shortcut?: string): SectionPanelItem => ({
    label, ...(icon ? { icon } : {}), ...(shortcut ? { hint: shortcutLabel(shortcut) } : {}), ...disabled(command), run,
  });
  const action = (id: keyof typeof QMD_ACTIONS, label = QMD_ACTIONS[id].label): SectionPanelItem =>
    item(label, QMD_ACTIONS[id].icon, QMD_ACTIONS[id].command, choose(() => runCommand(view, QMD_ACTIONS[id].command)), QMD_ACTIONS[id].shortcut);
  const headings = QMD_HEADINGS.filter((heading) => heading.level > 0);
  const languages = [language, ...CELL_LANGUAGES.filter((other) => other !== language)];
  const sections: SectionPanelSection[] = [
    { title: "Heading", layout: "chips", items: headings.map((heading) => item(heading.label, undefined, heading.command, styled(heading.command))) },
    { title: "List", layout: "chips", items: LIST_ACTIONS.map((id) => item(LIST_LABELS[id], QMD_ACTIONS[id].icon, QMD_ACTIONS[id].command, styled(QMD_ACTIONS[id].command))) },
    { title: "Code cell", layout: "chips", items: languages.map((lang) => {
      const command = insertCodeCell(lang);
      return item(cellLanguageLabel(lang), "code", command, choose(() => runCommand(view, command)));
    }) },
    { title: "Math and diagrams", items: [action("displayMath", "Equation"), action("drawing")] },
  ];
  if (!atGap) sections.push({ title: "Inline", layout: "chips", items: INLINE_ACTIONS.map((id) => ({ ...action(id), run: () => runAction(view, QMD_ACTIONS[id]) })) });
  if (source) sections.push({ title: "Note", items: [{ label: "Edit Markdown source", icon: "code", run: source }] });
  return { label: "Insert", sections, width: 340 };
}

/** A new paragraph for a text style: the caret into the empty paragraph it is in, else a new empty paragraph after the selected block. */
function insertText(view: EditorView): void {
  const { selection } = view.state;
  const { $from } = selection;
  if (!($from.parent.type === qmdSchema.nodes.paragraph && $from.parent.content.size === 0)) {
    const tr = view.state.tr.insert(selection.to, qmdSchema.nodes.paragraph!.create());
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, selection.to + 1)).scrollIntoView());
  }
  view.focus();
}

/**
 * The block choices of the empty note (plan D13): Cell (<language>), Equation and Diagram; its paragraph already takes text. Each choice first calls `place`, which puts the
 * selection where the block goes, then inserts there as the Insert panel does.
 */
export function blockChoiceItems(view: EditorView, language: CellLanguage, place: () => void): MenuItem[] {
  const choose = (insert: () => void) => () => { if (view.isDestroyed) return; place(); insert(); };
  const command = (run: Command) => choose(() => { runCommand(view, run); view.focus(); });
  const cell = (lang: CellLanguage): MenuItem => ({ label: `Cell (${cellLanguageLabel(lang)})`, icon: "code", onSelect: command(insertCodeCell(lang)) });
  return [
    cell(language),
    { label: "Equation", icon: QMD_ACTIONS.displayMath.icon, onSelect: command(QMD_ACTIONS.displayMath.command) },
    { label: "Diagram", icon: QMD_ACTIONS.drawing.icon, onSelect: command(QMD_ACTIONS.drawing.command) },
  ];
}

/** Whether the focus is in a node's own editor, such as a cell's code or an equation's LaTeX field. */
const inNodeEditor = (): boolean => document.activeElement?.closest?.(".qmd-cell-code, .qmd-math-edit") != null;

/** Centres the bubble over the selection from `from` to `to`, or under it when there is no room above, kept inside the window. */
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

/** One button per bubble action, each running its action on `view` when clicked. */
function bubbleButtons(view: EditorView): { button: HTMLButtonElement; action: QmdAction }[] {
  return BUBBLE_ACTIONS.map((id) => {
    const action: QmdAction = QMD_ACTIONS[id];
    const button = renderElement("button", { class: "qmd-bubble-btn", type: "button", title: `${action.label} (${shortcutLabel(action.shortcut)})`, "aria-label": action.label, html: renderIcon(action.icon) });
    button.addEventListener("click", () => runAction(view, action));
    return { button, action };
  });
}

/** Calls `after` once every transaction `view` dispatches is applied; returns the dispatcher it replaced, to restore. */
function afterTransactions(view: EditorView, after: () => void): EditorView["props"]["dispatchTransaction"] {
  const previous = view.props.dispatchTransaction;
  view.setProps({
    dispatchTransaction(tr) {
      if (previous) previous.call(this, tr);
      else view.updateState(view.state.apply(tr));
      after();
    },
  });
  return previous;
}

/**
 * Mounts the formatting bubble into `root`: bold, italic, inline math and link over a non-empty text selection of
 * `view`, with their pressed states, hidden otherwise and while a node's own editor or nothing in `root` has the focus.
 */
export function mountSelectionBubble(root: HTMLElement, view: EditorView): { refresh(): void; destroy(): void } {
  const buttons = bubbleButtons(view);
  const bubble = renderElement("div", { class: "qmd-bubble", role: "toolbar", "aria-label": "Formatting", hidden: true }, ...buttons.map(({ button }) => button));
  // Keeps the editor focused, and its selection, when a button is pressed with the mouse.
  bubble.addEventListener("mousedown", (event) => event.preventDefault());
  root.append(bubble);
  let blurred = false;

  function refresh(): void {
    if (view.isDestroyed) return;
    const { selection } = view.state;
    const show = view.editable && !blurred && view.dom.isConnected && selection instanceof TextSelection && !selection.empty && !inNodeEditor();
    bubble.hidden = !show;
    if (!show) return;
    for (const { button, action } of buttons) {
      button.disabled = !action.command(view.state);
      if (action.active) button.setAttribute("aria-pressed", String(action.active(view.state)));
    }
    placeBubble(view, bubble, selection.from, selection.to);
  }

  const onFocusIn = (): void => { blurred = false; refresh(); };
  const onFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget as Node | null;
    blurred = next !== null && !root.contains(next);
    refresh();
  };
  const onScroll = (): void => refresh();
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  window.addEventListener("scroll", onScroll, true);
  const previous = afterTransactions(view, refresh);

  return {
    refresh,
    destroy() {
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("scroll", onScroll, true);
      if (!view.isDestroyed && previous) view.setProps({ dispatchTransaction: previous });
      bubble.remove();
    },
  };
}
