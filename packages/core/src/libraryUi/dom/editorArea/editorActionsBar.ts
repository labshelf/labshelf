// Builds the toolbar at the end of a group's tab strip and paints the active tab's actions into it.
import { renderElement, renderIcon, showMenu } from "../../../ui/dom/index.js";
import type { EditorTabAction } from "./editorAreaOptions.js";

export interface EditorActionsBar {
  el: HTMLElement;
  /** Shows `actions`, or hides the bar when there are none; the same array twice leaves the buttons in place. */
  render(actions: readonly EditorTabAction[]): void;
}

function actionButton(label: string, glyph: string, onClick: (button: HTMLButtonElement) => void): HTMLButtonElement {
  const button = renderElement("button", { class: "ls-icon-btn ls-editor-action", type: "button", title: label, "aria-label": label, html: glyph });
  button.addEventListener("click", () => onClick(button));
  return button;
}

export function createEditorActionsBar(): EditorActionsBar {
  const bar = renderElement("div", { class: "ls-editor-actions", role: "toolbar", "aria-label": "Editor actions", hidden: true });
  let shown: readonly EditorTabAction[] | null = null;

  return {
    el: bar,
    render(actions) {
      if (actions === shown) return;
      shown = actions;
      const inline = actions.filter((a) => !a.overflow);
      const overflow = actions.filter((a) => a.overflow);
      const buttons = inline.map((a) => actionButton(a.label, renderIcon(a.icon), () => a.run()));
      if (overflow.length > 0) {
        buttons.push(actionButton("More Actions…", renderIcon("more"), (anchor) => {
          showMenu(anchor, overflow.map((a) => ({ label: a.label, icon: a.icon, onSelect: () => a.run() })));
        }));
      }
      bar.replaceChildren(...buttons);
      bar.hidden = buttons.length === 0;
    },
  };
}
