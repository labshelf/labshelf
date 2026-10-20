// Builds the notice above a shared file whose session could not start, with the action that tries again.
import { el, icon } from "@labshelf/core/dom";

export function unresolvedNotice(retry: () => void): HTMLElement {
  const button = el("button", { type: "button", class: "ls-btn ls-button-soft", html: icon("refresh") }, "Retry");
  button.addEventListener("click", () => { button.disabled = true; retry(); });
  return el("div", { class: "ls-source-notice", role: "status" },
    el("span", { class: "ls-source-notice-icon", "aria-hidden": "true", html: icon("cloud-off") }),
    el("span", { class: "ls-source-notice-text" }, "Could not start the shared session. This file is read-only until it starts, so no edit stays outside the share."),
    button);
}
