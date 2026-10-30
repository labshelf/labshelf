// Fills the formatting toolbar of the rich Markdown editor: one compact row of icon buttons for headings, marks, lists, links and inline math, and an Insert menu, with their pressed and disabled states kept in step with the selection and arrow keys moving between them.
import type { Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { renderElement, showMenu } from "../../ui/dom/index.js";
import { renderIcon, type IconName } from "../../ui/icons/index.js";
import { QMD_ACTIONS, QMD_HEADINGS, shortcutLabel, type QmdAction } from "./qmdCommands.js";

const GROUPS: (keyof typeof QMD_ACTIONS | "heading")[][] = [
  ["heading", "bold", "italic"], ["bullet", "ordered", "task"], ["link", "inlineMath"],
];
const INSERT_ACTIONS = ["inlineMath", "displayMath", "codeCell", "link"] as const;

const HEADING_LABEL = "Heading";

/** One rendered button and how to refresh it. */
interface ToolbarButton { button: HTMLButtonElement; command: Command; active?: QmdAction["active"]; update?(): void }

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

/** The paragraph style menu: the button shows the current heading level (H1–H3) or the heading icon for body text. */
function createHeadingButton(view: EditorView, buttons: ToolbarButton[]): HTMLButtonElement {
  const levels = QMD_HEADINGS.filter((heading) => heading.level > 0);
  const range = `${shortcutLabel(levels[0]?.shortcut ?? "")}–${levels[levels.length - 1]?.level ?? ""}`;
  const button = renderButton(HEADING_LABEL, "heading", range);
  button.setAttribute("aria-haspopup", "menu");
  button.classList.add("qmd-toolbar-heading");
  const caption = renderElement("span", { class: "qmd-toolbar-heading-level", "aria-hidden": "true" });
  const icon = renderElement("span", { class: "qmd-toolbar-heading-icon", "aria-hidden": "true", html: renderIcon("heading") });
  button.replaceChildren(icon, caption, renderElement("span", { class: "qmd-toolbar-caret", html: renderIcon("chevron-down"), "aria-hidden": "true" }));
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
  const update = (): void => {
    const level = QMD_HEADINGS.find((heading) => heading.active(view.state) && heading.level > 0)?.level;
    caption.textContent = level ? `H${level}` : "";
    icon.hidden = level !== undefined;
    button.setAttribute("aria-label", level ? `${HEADING_LABEL}: level ${level}` : `${HEADING_LABEL}: body text`);
  };
  buttons.push({ button, command: anyHeading, update });
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

function createInsertButton(view: EditorView, source?: () => void): HTMLButtonElement {
  const button = renderElement("button", { class: "qmd-toolbar-btn qmd-toolbar-insert", type: "button", "aria-haspopup": "menu", "aria-label": "Insert", title: "Insert", html: renderIcon("plus") });
  button.addEventListener("click", () => showMenu(button, [
    ...INSERT_ACTIONS.map((id) => {
      const action = QMD_ACTIONS[id];
      return { label: action.label, icon: action.icon, hint: shortcutLabel(action.shortcut), disabled: !action.command(view.state), onSelect: () => { runCommand(view, action.command); if (id !== "link") { view.focus(); } } };
    }),
    ...(source ? ["separator" as const, { label: "Edit Markdown source", icon: "code" as const, onSelect: source }] : []),
  ]));
  return button;
}

/** Arrow keys, Home and End move focus between the toolbar's enabled buttons; Tab enters and leaves the toolbar at one stop. */
function rovingFocus(root: HTMLElement): { refresh(): void; destroy(): void } {
  const enabled = (): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>("button")).filter((button) => !button.disabled);
  const refresh = (): void => {
    const all = enabled();
    const current = all.find((button) => button.tabIndex === 0) ?? all[0];
    for (const button of root.querySelectorAll<HTMLButtonElement>("button")) button.tabIndex = button === current ? 0 : -1;
  };
  const onKey = (event: KeyboardEvent): void => {
    const all = enabled();
    const index = all.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: all.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = all[(next + all.length) % all.length]!;
    for (const button of all) button.tabIndex = button === target ? 0 : -1;
    target.focus();
  };
  root.addEventListener("keydown", onKey);
  return { refresh, destroy: () => root.removeEventListener("keydown", onKey) };
}

/** Mounts the toolbar's buttons into `root` and drives `view` with them; `destroy` removes them and their listeners. */
export function mountQmdToolbar(root: HTMLElement, view: EditorView, source?: () => void): { destroy(): void } {
  const buttons: ToolbarButton[] = [];
  root.setAttribute("role", "toolbar");
  root.setAttribute("aria-label", "Formatting");
  for (const group of GROUPS) {
    const groupEl = renderElement("div", { class: "qmd-toolbar-group", role: "group" });
    for (const id of group) groupEl.append(id === "heading" ? createHeadingButton(view, buttons) : createActionButton(view, buttons, QMD_ACTIONS[id]));
    root.append(groupEl);
  }

  root.append(createInsertButton(view, source));
  const roving = rovingFocus(root);

  function refresh(): void {
    if (view.isDestroyed) return;
    const state = view.state;
    for (const { button, command, active, update } of buttons) {
      update?.();
      button.disabled = !command(state);
      if (active) button.setAttribute("aria-pressed", String(active(state)));
    }
    roving.refresh();
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
      roving.destroy();
      editorRoot?.removeEventListener("focusin", refresh);
      if (!view.isDestroyed && previous) view.setProps({ dispatchTransaction: previous });
      root.replaceChildren();
      root.removeAttribute("role");
      root.removeAttribute("aria-label");
    },
  };
}
