// Creates the titlebar button that shows and hides the Details pane.
import { el, icon } from "@labshelf/core/dom";
import type { PageShell } from "./pageShell";

export function createDetailsToggle(shell: Pick<PageShell, "root" | "toggleDetails">): HTMLElement {
  const button = el("button", { class: "ls-icon-btn", type: "button", title: "Toggle Details", "aria-label": "Toggle Details", html: icon("panel-right") });
  const sync = (): void => { button.setAttribute("aria-pressed", String(!shell.root.classList.contains("details-collapsed"))); };
  button.addEventListener("click", shell.toggleDetails);
  // The sash also collapses and restores the pane, so the state is read from the class rather than from clicks.
  new MutationObserver(sync).observe(shell.root, { attributes: true, attributeFilter: ["class"] });
  sync();
  return button;
}
