// Builds the floating panel the helper setup card mounts into: core dialog look, beside the editor rather than over it, closable.
import { el, icon } from "@labshelf/core/dom";
import type { SetupSlot } from "./helperSetupShower";

export function createHelperSetupPanel(parent: HTMLElement): SetupSlot {
  const body = el("div", { class: "editor-helper-setup-body" });
  const close = el("button", { class: "ls-icon-btn", type: "button", title: "Close", "aria-label": "Close", html: icon("x") });
  const panel = el("aside", { class: "ls-dialog editor-helper-setup", role: "dialog", "aria-label": "Set up LaTeX builds", hidden: true },
    el("div", { class: "ls-dialog-head" },
      el("span", { html: icon("info") }),
      el("div", { class: "ls-dialog-title", text: "LaTeX builds need LabShelf Helper" }),
      close,
    ),
    body,
  );
  // Closing only hides the panel: the card keeps checking for the helper, and the next build that needs it shows the panel again.
  close.addEventListener("click", () => { panel.hidden = true; });
  parent.append(panel);
  return { element: body, reveal: () => { panel.hidden = false; } };
}
