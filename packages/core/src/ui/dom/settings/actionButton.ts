/** Builds a settings action: an icon and a label on the shared button, disabled while its handler runs. */
import { icon, type IconName } from "../../icons/index.js";
import { el } from "../dom.js";

export interface ActionButtonOptions {
  label: string;
  icon: IconName;
  primary?: boolean;
  /** Handlers report their own failures; the button only waits for them. */
  onClick: () => void | Promise<void>;
}

export function actionButton(options: ActionButtonOptions): HTMLButtonElement {
  const button = el("button", { class: `ls-btn${options.primary ? " ls-btn-primary" : ""}`, type: "button", html: icon(options.icon) });
  button.append(el("span", { text: options.label }));
  button.addEventListener("click", () => {
    button.disabled = true;
    void (async () => {
      try { await options.onClick(); } finally { button.disabled = false; }
    })();
  });
  return button;
}
