// Fills the formatting toolbar of the rich Markdown editor: ghost icon buttons for marks, headings, lists, math, code cells and links, with their pressed and disabled states kept in step with the selection.
import type { Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { renderElement, showMenu } from "../../ui/dom/index.js";
import { renderIcon, type IconName } from "../../ui/icons/index.js";
import { QMD_ACTIONS, QMD_HEADINGS, shortcutLabel, type QmdAction } from "./qmdCommands.js";

const GROUPS: (keyof typeof QMD_ACTIONS | "heading")[][] = [
  ["bold", "italic"],
  ["heading", "bullet", "ordered", "task"],
  ["inlineMath", "displayMath", "codeCell"],
  ["link"],
];

const HEADING_LABEL = "Heading";

/** One rendered button and how to refresh it. */
interface ToolbarButton { button: HTMLButtonElement; command: Command; active?: QmdAction["active"] }

function renderButton(label: string, icon: IconName, shortcut: string): HTMLButtonElement {
  return renderElement("button", {
    class: "ls-btn ls-btn-ghost qmd-toolbar-btn",
    type: "button",
    title: `${label} (${shortcut})`,
    "aria-label": label,
    html: renderIcon(icon),
  });
}

const runCommand = (view: EditorView, command: Command): boolean => command(view.state, view.dispatch.bind(view), view);

function createHeadingButton(view: EditorView, buttons: ToolbarButton[]): HTMLButtonElement {
  const levels = QMD_HEADINGS.filter((heading) => heading.level > 0);
  const range = `${shortcutLabel(levels[0]?.shortcut ?? "")}–${levels[levels.length - 1]?.level ?? ""}`;
  const button = renderButton(HEADING_LABEL, "heading", range);
  button.setAttribute("aria-haspopup", "menu");
  button.addEventListener("click", () => {
    showMenu(
      button,
      QMD_HEADINGS.map((heading) => ({
        label: heading.label,
        checked: heading.active(view.state),
        radio: true,
        hint: shortcutLabel(heading.shortcut),
        disabled: !heading.command(view.state),
        onSelect: () => {
          runCommand(view, heading.command);
          view.focus();
        },
      })),
    );
  });
  // Enabled while any heading level or the paragraph applies.
  const anyHeading: Command = (state) => QMD_HEADINGS.some((heading) => heading.active(state) || heading.command(state));
  buttons.push({ button, command: anyHeading });
  return button;
}

function createActionButton(view: EditorView, buttons: ToolbarButton[], action: QmdAction): HTMLButtonElement {
  const button = renderButton(action.label, action.icon, shortcutLabel(action.shortcut));
  button.addEventListener("click", () => {
    runCommand(view, action.command);
    // The link command opens an input box that takes focus and hands it back itself.
    if (action.id !== "link") view.focus();
  });
  buttons.push({ button, command: action.command, active: action.active });
  return button;
}

/** Mounts the toolbar's buttons into `root` and drives `view` with them; `destroy` removes them and their listeners. */
export function mountQmdToolbar(root: HTMLElement, view: EditorView): { destroy(): void } {
  const buttons: ToolbarButton[] = [];
  root.setAttribute("role", "toolbar");
  root.setAttribute("aria-label", "Formatting");
  for (const group of GROUPS) {
    const groupEl = renderElement("div", { class: "qmd-toolbar-group", role: "group" });
    for (const id of group) groupEl.append(id === "heading" ? createHeadingButton(view, buttons) : createActionButton(view, buttons, QMD_ACTIONS[id]));
    root.append(groupEl);
  }

  function refresh(): void {
    if (view.isDestroyed) return;
    const state = view.state;
    for (const { button, command, active } of buttons) {
      button.disabled = !command(state);
      if (active) button.setAttribute("aria-pressed", String(active(state)));
    }
  }

  // Keeps the editor focused, and its selection, when a button is pressed with the mouse.
  const keepFocus = (event: MouseEvent): void => event.preventDefault();
  root.addEventListener("mousedown", keepFocus);
  const editorRoot = root.parentElement;
  editorRoot?.addEventListener("focusin", refresh);
  const previous = view.props.dispatchTransaction;
  view.setProps({
    dispatchTransaction(tr) {
      if (previous) previous.call(this, tr);
      else view.updateState(view.state.apply(tr));
      refresh();
    },
  });
  refresh();

  return {
    destroy() {
      root.removeEventListener("mousedown", keepFocus);
      editorRoot?.removeEventListener("focusin", refresh);
      if (!view.isDestroyed && previous) view.setProps({ dispatchTransaction: previous });
      root.replaceChildren();
      root.removeAttribute("role");
      root.removeAttribute("aria-label");
    },
  };
}
