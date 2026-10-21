// Builds the notices above a shared file that opens read-only, each with the action that lets it edit.
import { el, icon, type IconName } from "@labshelf/core/dom";

function readOnlyNotice(iconName: IconName, text: string, action: { label: string; icon: IconName; run: () => void }): HTMLElement {
  const button = el("button", { type: "button", class: "ls-btn ls-button-soft", html: icon(action.icon) }, action.label);
  button.addEventListener("click", () => { button.disabled = true; action.run(); });
  return el("div", { class: "ls-source-notice", role: "status" },
    el("span", { class: "ls-source-notice-icon", "aria-hidden": "true", html: icon(iconName) }),
    el("span", { class: "ls-source-notice-text" }, text),
    button);
}

export function unresolvedNotice(retry: () => void): HTMLElement {
  return readOnlyNotice("cloud-off", "Could not start the shared session. This file is read-only until it starts, so no edit stays outside the share.", { label: "Retry", icon: "refresh", run: retry });
}

export function observingNotice(useHere: () => void): HTMLElement {
  return readOnlyNotice("external", "This shared project is open in another tab. This file is read-only here until you use it here or that tab closes.", { label: "Use here", icon: "target", run: useHere });
}
