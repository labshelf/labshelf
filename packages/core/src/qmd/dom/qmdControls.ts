// Draws the visible controls of the rich Markdown editor in place of a toolbar: a small bubble of marks over a text selection and a round Insert button under the text.
import { TextSelection, type Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { renderElement, showMenu, type MenuAnchor, type MenuEntry, type MenuItem } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { CELL_LANGUAGES, cellLanguageLabel } from "../compute/index.js";
import { insertCodeCell, QMD_ACTIONS, QMD_HEADINGS, shortcutLabel, type QmdAction } from "./qmdCommands.js";

const BUBBLE_ACTIONS = ["bold", "italic", "inlineMath", "link"] as const;
const LIST_ACTIONS = ["bullet", "ordered", "task"] as const;
const BLOCK_ACTIONS = ["inlineMath", "link"] as const;
const GAP = 6;
const MARGIN = 8;

const runCommand = (view: EditorView, command: Command): boolean => command(view.state, view.dispatch.bind(view), view);

/** Runs `action` and gives the editor its focus back; the link command opens an input box that hands focus back itself. */
function runAction(view: EditorView, action: QmdAction): void {
  runCommand(view, action.command);
  if (action.id !== "link") view.focus();
}

/** The Insert menu: paragraph styles, lists, then blocks (one code cell entry per cell language), and the Markdown source when the host offers it. */
function insertItems(view: EditorView, source?: () => void): MenuEntry[] {
  const actionItem = (action: QmdAction): MenuItem => ({ label: action.label, icon: action.icon, hint: shortcutLabel(action.shortcut), disabled: !action.command(view.state), onSelect: () => runAction(view, action) });
  return [
    ...QMD_HEADINGS.map((heading): MenuItem => ({ label: heading.label, hint: shortcutLabel(heading.shortcut), disabled: !heading.command(view.state), onSelect: () => { runCommand(view, heading.command); view.focus(); } })),
    "separator" as const,
    ...LIST_ACTIONS.map((id) => actionItem(QMD_ACTIONS[id])),
    "separator" as const,
    actionItem(QMD_ACTIONS.displayMath),
    ...CELL_LANGUAGES.map((language): MenuItem => {
      const command = language === "python" ? QMD_ACTIONS.codeCell.command : insertCodeCell(language);
      return {
        label: `Code cell (${cellLanguageLabel(language)})`, icon: "code",
        ...(language === "python" ? { hint: shortcutLabel(QMD_ACTIONS.codeCell.shortcut) } : {}),
        disabled: !command(view.state), onSelect: () => { runCommand(view, command); view.focus(); },
      };
    }),
    ...BLOCK_ACTIONS.map((id) => actionItem(QMD_ACTIONS[id])),
    ...(source ? ["separator" as const, { label: "Edit Markdown source", icon: "code" as const, onSelect: source }] : []),
  ];
}

/** The round `+` that opens the Insert menu and inserts at the caret. */
export function renderInsertButton(view: EditorView, source?: () => void): HTMLButtonElement {
  const button = renderElement("button", { class: "qmd-editor-insert", type: "button", "aria-haspopup": "menu", "aria-label": "Insert", title: "Insert", html: renderIcon("plus") });
  // Keeps the caret where it was, so the menu inserts there.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => showInsertMenu(view, button, source));
  return button;
}

/** Opens the Insert menu at `anchor` (the + button or a point), inserting at the caret. */
export function showInsertMenu(view: EditorView, anchor: HTMLElement | MenuAnchor, source?: () => void): void {
  showMenu(anchor, insertItems(view, source));
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
