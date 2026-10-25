/** Builds a settings action: an icon and a label on the shared button, disabled while its handler runs. */
import { renderIcon, type IconName } from "../../icons/index.js";
import { renderElement } from "../dom.js";

export interface ActionButtonOptions {
  label: string;
  icon: IconName;
  primary?: boolean;
  /** Handlers report their own failures; the button only waits for them. */
  onClick: () => void | Promise<void>;
}

export function renderActionButton(options: ActionButtonOptions): HTMLButtonElement {
  const button = renderElement("button", { class: `ls-btn${options.primary ? " ls-btn-primary" : ""}`, type: "button", html: renderIcon(options.icon) });
  button.append(renderElement("span", { text: options.label }));
  button.addEventListener("click", () => {
    button.disabled = true;
    void (async () => {
      try { await options.onClick(); } finally { button.disabled = false; }
    })();
  });
  return button;
}
